"""Treino de modelos TinyML (DENSA, CNN1D, DS_CNN) executado em segundo plano.

Recebe o pedido de `POST /treinos` (objeto com treinoId, csv, saidaDir, config,
callbackUrl e callbackToken), treina, grava model.tflite e model_data.h em
saidaDir e avisa o servidor pelo callback com EXECUTANDO, SUCESSO ou FALHA.
"""

import logging
import multiprocessing
import os
import traceback
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split

from app import exportar

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get('DATA_DIR', '/data')
PROPORCAO_TESTE = 0.2
SEMENTE = 42
TAMANHO_LOTE = 32
PACIENCIA = 10
DROPOUT = 0.2
EPOCAS_POR_ENVIO = 5


class Registro:
    """Acumula o log do treino e envia ao servidor só as linhas novas."""

    def __init__(self, pedido):
        self.pedido = pedido
        self.linhas: list[str] = []
        self.enviadas = 0

    def adicionar(self, texto: str) -> None:
        self.linhas.append(texto)

    def pendente(self) -> str:
        texto = '\n'.join(self.linhas[self.enviadas:])
        self.enviadas = len(self.linhas)
        return texto

    def enviar(self, status: str, **extra) -> None:
        corpo = {'status': status, 'log': self.pendente(), **extra}
        _callback(self.pedido, corpo)


def _callback(pedido, corpo: dict) -> None:
    """Chama o servidor. Nunca lança: falha de callback só é registrada."""
    try:
        resposta = httpx.post(
            pedido.callbackUrl,
            json=corpo,
            headers={'X-Interno-Token': pedido.callbackToken},
            timeout=15,
        )
        if resposta.status_code >= 300:
            logger.warning('Callback do treino %s respondeu %s', pedido.treinoId, resposta.status_code)
    except httpx.HTTPError as erro:
        logger.warning('Falha no callback do treino %s: %s', pedido.treinoId, erro)


def _relativo_a_dados(caminho: Path) -> str:
    return os.path.relpath(caminho, DATA_DIR).replace('\\', '/')


def executar(pedido) -> None:
    """Ponto de entrada do treino em segundo plano. Nunca lança exceção.

    O treino roda em um processo filho (spawn), para que uma falha nativa
    (ex.: abort do TFLite) não derrube o uvicorn. Se o filho morrer antes de
    enviar o callback final, o pai envia FALHA.
    """
    contexto = multiprocessing.get_context('spawn')
    terminou = contexto.Value('b', False)
    processo = contexto.Process(target=_executar_no_processo, args=(pedido, terminou))
    processo.start()
    processo.join()

    if processo.exitcode != 0 and not terminou.value:
        logger.error('Processo do treino %s terminou com código %s', pedido.treinoId, processo.exitcode)
        _callback(pedido, {
            'status': 'FALHA',
            'log': (
                f'O processo de treino terminou de forma inesperada (código {processo.exitcode}). '
                'Veja os logs do container trainer.'
            ),
        })


def _executar_no_processo(pedido, terminou) -> None:
    try:
        _executar_local(pedido)
    finally:
        terminou.value = True


def _executar_local(pedido) -> None:
    registro = Registro(pedido)
    try:
        registro.adicionar(f'Treino {pedido.treinoId} iniciado.')
        registro.enviar('EXECUTANDO')

        resultado = _treinar(pedido, registro)

        registro.adicionar('Treino concluído com sucesso.')
        registro.enviar('SUCESSO', **resultado)
    except Exception:
        registro.adicionar('Erro durante o treino:')
        registro.adicionar(traceback.format_exc())
        registro.enviar('FALHA')


def _carregar_dados(pedido, registro: Registro):
    df = pd.read_csv(pedido.csv, dtype={'rotulo': str})
    if 'rotulo' not in df.columns:
        raise ValueError("CSV sem a coluna 'rotulo'")
    if df.empty:
        raise ValueError('CSV sem amostras')

    cfg = pedido.config
    rotulos = df['rotulo'].astype(str)
    atributos = df.drop(columns=['rotulo']).to_numpy(dtype=np.float32)

    classes = list(cfg.classes) if cfg.classes else sorted(rotulos.unique())
    desconhecidos = sorted(set(rotulos) - set(classes))
    if desconhecidos:
        raise ValueError(f'Rótulos fora das classes configuradas: {", ".join(desconhecidos)}')
    mapa = {classe: i for i, classe in enumerate(classes)}
    y = rotulos.map(mapa).to_numpy(dtype=np.int64)

    media = atributos.mean(axis=0)
    desvio = atributos.std(axis=0)
    desvio[desvio == 0] = 1.0
    x = (atributos - media) / desvio

    registro.adicionar(
        f'Dados: {x.shape[0]} amostras, {x.shape[1]} atributos, {len(classes)} classes {classes}.'
    )
    return x, y, classes, {'media': media.tolist(), 'desvio': desvio.tolist()}


def _dividir(x, y, registro: Registro):
    try:
        return train_test_split(
            x, y, test_size=PROPORCAO_TESTE, random_state=SEMENTE, stratify=y
        )
    except ValueError:
        registro.adicionar('Divisão estratificada impossível com estes dados; usando divisão simples.')
        return train_test_split(x, y, test_size=PROPORCAO_TESTE, random_state=SEMENTE)


def _construir_modelo(cfg, entradas: int, n_classes: int, registro: Registro):
    arquitetura = cfg.arquitetura
    janela, canais = cfg.entrada.janela, cfg.entrada.canais

    if arquitetura in ('CNN1D', 'DS_CNN') and entradas != janela * canais:
        registro.adicionar(
            f'Colunas ({entradas}) diferentes de janela×canais ({janela}×{canais}); usando DENSA.'
        )
        arquitetura = 'DENSA'

    entrada = tf.keras.Input(shape=(entradas,))
    h = entrada
    if arquitetura == 'DENSA':
        for _ in range(cfg.camadas):
            h = tf.keras.layers.Dense(cfg.neuronios, activation='relu')(h)
            h = tf.keras.layers.Dropout(DROPOUT)(h)
    else:
        h = tf.keras.layers.Reshape((janela, canais))(h)
        for _ in range(cfg.camadas):
            if arquitetura == 'CNN1D':
                h = tf.keras.layers.Conv1D(cfg.neuronios, 3, padding='same', activation='relu')(h)
            else:
                h = tf.keras.layers.SeparableConv1D(
                    cfg.neuronios, 3, padding='same', activation='relu'
                )(h)
            h = tf.keras.layers.MaxPool1D(2, padding='same')(h)
        h = tf.keras.layers.GlobalAveragePooling1D()(h)

    saida = tf.keras.layers.Dense(n_classes, activation='softmax')(h)
    modelo = tf.keras.Model(entrada, saida)
    modelo.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=cfg.taxaAprendizado),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )
    registro.adicionar(f'Arquitetura: {arquitetura}, {modelo.count_params()} parâmetros.')
    return modelo, arquitetura


class _LogPorEpoca(tf.keras.callbacks.Callback):
    def __init__(self, registro: Registro, total_epocas: int):
        super().__init__()
        self.registro = registro
        self.total_epocas = total_epocas

    def on_epoch_end(self, epoca, logs=None):
        logs = logs or {}
        self.registro.adicionar(
            f"Época {epoca + 1}/{self.total_epocas}: "
            f"perda={logs.get('loss', 0):.4f} acuracia={logs.get('accuracy', 0):.4f} "
            f"perda_val={logs.get('val_loss', 0):.4f} acuracia_val={logs.get('val_accuracy', 0):.4f}"
        )
        if (epoca + 1) % EPOCAS_POR_ENVIO == 0:
            self.registro.enviar('EXECUTANDO')


def _treinar(pedido, registro: Registro) -> dict:
    cfg = pedido.config
    x, y, classes, normalizacao = _carregar_dados(pedido, registro)
    x_treino, x_teste, y_treino, y_teste = _dividir(x, y, registro)
    n_classes = len(classes)

    modelo, arquitetura = _construir_modelo(cfg, x.shape[1], n_classes, registro)
    registro.adicionar(f'Treinando: até {cfg.epocas} épocas, lote {TAMANHO_LOTE}.')

    parada = tf.keras.callbacks.EarlyStopping(
        monitor='val_loss', patience=PACIENCIA, restore_best_weights=True
    )
    modelo.fit(
        x_treino,
        y_treino,
        validation_data=(x_teste, y_teste),
        epochs=cfg.epocas,
        batch_size=TAMANHO_LOTE,
        callbacks=[parada, _LogPorEpoca(registro, cfg.epocas)],
        verbose=0,
    )

    perda_treino, acuracia_treino = modelo.evaluate(x_treino, y_treino, verbose=0)
    perda_teste, acuracia_teste = modelo.evaluate(x_teste, y_teste, verbose=0)
    previsoes = np.argmax(modelo.predict(x_teste, verbose=0), axis=1)
    matriz = np.zeros((n_classes, n_classes), dtype=np.int64)
    np.add.at(matriz, (y_teste, previsoes), 1)

    metricas = {
        'acuracia': float(acuracia_treino),
        'perda': float(perda_treino),
        'acuraciaValidacao': float(acuracia_teste),
        'matrizConfusao': matriz.tolist(),
        'classes': classes,
        'normalizacao': normalizacao,
        'arquitetura': arquitetura,
    }

    registro.adicionar('Exportando modelo para TFLite e header C...')
    tflite = exportar.para_tflite(modelo, x_treino, cfg.quantizacao)
    cabecalho = exportar.para_header_c(tflite)

    pasta = Path(pedido.saidaDir)
    pasta.mkdir(parents=True, exist_ok=True)
    caminho_tflite = pasta / 'model.tflite'
    caminho_h = pasta / 'model_data.h'
    caminho_tflite.write_bytes(tflite)
    caminho_h.write_text(cabecalho, encoding='utf-8')
    registro.adicionar(f'Modelo gravado: {len(tflite)} bytes.')

    return {
        'metricas': metricas,
        'modeloTflite': _relativo_a_dados(caminho_tflite),
        'modeloH': _relativo_a_dados(caminho_h),
        'tamanhoBytes': len(tflite),
    }
