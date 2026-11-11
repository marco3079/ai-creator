"""Treino TinyML: CLASSIFICACAO e REGRESSAO (CSV) e IMAGEM (pastas por classe).

Gera model.tflite, model_data.h e metricas.json em `saidaDir` e devolve os
artefatos e as métricas pelo callback `enviar`.

O TensorFlow só é importado dentro das funções que precisam dele: as funções
puras (escolher_principal, metricas_regressao, montar_artefatos) podem ser
testadas sem TensorFlow.
"""

import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app import exportar

ARQUIVO_FINAL = '.final'  # mesmo nome usado por app.modelos.executar
SEMENTE = 42
PROPORCAO_TESTE = 0.2
PACIENCIA = 10
DROPOUT = 0.2
EPOCAS_POR_ENVIO = 5
DATA_DIR = os.environ.get('DATA_DIR', '/data')


class _Log:
    """Acumula as linhas do log e envia ao servidor só as novas."""

    def __init__(self, enviar):
        self._enviar = enviar
        self.linhas: list[str] = []
        self._enviadas = 0

    def adicionar(self, texto: str) -> None:
        self.linhas.append(texto)

    def enviar(self, status: str, **extra) -> None:
        texto = '\n'.join(self.linhas[self._enviadas:])
        self._enviadas = len(self.linhas)
        self._enviar(status=status, log=texto, **extra)


# ---------------------------------------------------------------- funções puras

def escolher_principal(tarefa: str, metricas: dict) -> dict:
    """Métrica principal exibida na lista de modelos e nos treinos."""
    if tarefa == 'REGRESSAO':
        return {'nome': 'r2', 'rotulo': 'R²', 'valor': float(metricas['r2']), 'formato': 'numero'}
    return {
        'nome': 'acuraciaValidacao',
        'rotulo': 'Acurácia (val.)',
        'valor': float(metricas['acuraciaValidacao']) * 100,
        'formato': 'percentual',
    }


def metricas_regressao(y_real, y_previsto) -> dict:
    """MAE, RMSE e R² na escala original do rótulo."""
    real = np.asarray(y_real, dtype=np.float64)
    previsto = np.asarray(y_previsto, dtype=np.float64)
    erro = previsto - real
    ss_res = float(np.sum(erro ** 2))
    ss_tot = float(np.sum((real - real.mean()) ** 2))
    if ss_tot > 0:
        r2 = 1.0 - ss_res / ss_tot
    else:
        r2 = 1.0 if ss_res == 0 else 0.0
    return {
        'mae': float(np.mean(np.abs(erro))),
        'rmse': float(np.sqrt(np.mean(erro ** 2))),
        'r2': float(r2),
    }


def montar_artefatos(arquivos: list[tuple[str, str, Path]], data_dir: str) -> list[dict]:
    """(nome, tipo, caminho absoluto) → Artefato com caminho relativo a `data_dir`."""
    return [
        {
            'nome': nome,
            'tipo': tipo,
            'caminho': os.path.relpath(caminho, data_dir).replace('\\', '/'),
            'tamanhoBytes': os.path.getsize(caminho),
        }
        for nome, tipo, caminho in arquivos
    ]


# ---------------------------------------------------------------- auxiliares

def _ns(valor):
    """Converte dicts aninhados em objetos com atributos (para reaproveitar app.treino)."""
    if isinstance(valor, dict):
        return SimpleNamespace(**{chave: _ns(v) for chave, v in valor.items()})
    if isinstance(valor, list):
        return [_ns(v) for v in valor]
    return valor


def _criar_log_epocas(tf, log: _Log, total: int, historico: list, nome: str, chave_keras: str):
    """Callback Keras: uma linha de log por época (português) e histórico por época."""

    class LogEpocas(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoca, logs=None):
            logs = logs or {}
            perda = float(logs.get('loss', 0.0))
            perda_val = float(logs.get('val_loss', 0.0))
            valor = float(logs.get(chave_keras, 0.0))
            valor_val = float(logs.get(f'val_{chave_keras}', 0.0))
            historico.append({
                'epoca': epoca + 1,
                'perda': perda,
                'perdaValidacao': perda_val,
                nome: valor,
                f'{nome}Validacao': valor_val,
            })
            log.adicionar(
                f'Época {epoca + 1}/{total}: perda={perda:.4f} {nome}={valor:.4f} '
                f'perda_val={perda_val:.4f} {nome}_val={valor_val:.4f}'
            )
            if (epoca + 1) % EPOCAS_POR_ENVIO == 0:
                log.enviar('EXECUTANDO')

    return LogEpocas()


def _tflite_regressao(modelo, x_rep, quantizacao: str, log: _Log) -> bytes:
    """Como exportar.para_tflite, mas com saída float32 no INT8 (a regressão não tem classes)."""
    if quantizacao != 'INT8':
        return exportar.para_tflite(modelo, x_rep, quantizacao)

    import tensorflow as tf

    amostras = np.asarray(x_rep, dtype=np.float32)[:exportar.AMOSTRAS_REPRESENTATIVAS]

    def dataset_representativo():
        for i in range(len(amostras)):
            yield [amostras[i:i + 1]]

    conversor = tf.lite.TFLiteConverter.from_keras_model(modelo)
    conversor.optimizations = [tf.lite.Optimize.DEFAULT]
    conversor.representative_dataset = dataset_representativo
    conversor.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    conversor.inference_input_type = tf.int8
    conversor.inference_output_type = tf.float32
    log.adicionar(
        'INT8 com saída float32 (inference_output_type float32): entrada int8, saída float32. '
        'A saída do modelo está normalizada: valor = saída × desvio + média (ver normalizacao.rotulo).'
    )
    return conversor.convert()


# ---------------------------------------------------------------- tarefas

def _treinar_classificacao(pedido: dict, cfg: dict, log: _Log):
    import tensorflow as tf

    from app import treino  # carregamento de dados, divisão e arquitetura DENSA/CNN1D/DS_CNN

    dataset = pedido['dataset']
    pedido_csv = SimpleNamespace(
        csv=dataset['caminho'],
        config=SimpleNamespace(classes=list(dataset.get('classes') or [])),
    )
    x, y, classes, normalizacao = treino._carregar_dados(pedido_csv, log)
    x_treino, x_teste, y_treino, y_teste = treino._dividir(x, y, log)
    modelo, arquitetura = treino._construir_modelo(_ns(cfg), x.shape[1], len(classes), log)

    epocas = int(cfg['epocas'])
    lote = int(cfg['tamanhoLote'])
    log.adicionar(f'Treinando: até {epocas} épocas, lote {lote}.')
    historico: list = []
    parada = tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=PACIENCIA, restore_best_weights=True)
    modelo.fit(
        x_treino,
        y_treino,
        validation_data=(x_teste, y_teste),
        epochs=epocas,
        batch_size=lote,
        callbacks=[parada, _criar_log_epocas(tf, log, epocas, historico, 'acuracia', 'accuracy')],
        verbose=0,
    )

    perda_treino, acuracia_treino = modelo.evaluate(x_treino, y_treino, verbose=0)
    perda_teste, acuracia_teste = modelo.evaluate(x_teste, y_teste, verbose=0)
    previsoes = np.argmax(modelo.predict(x_teste, verbose=0), axis=1)
    matriz = np.zeros((len(classes), len(classes)), dtype=np.int64)
    np.add.at(matriz, (y_teste, previsoes), 1)

    metricas = {
        'acuracia': float(acuracia_treino),
        'perda': float(perda_treino),
        'acuraciaValidacao': float(acuracia_teste),
        'perdaValidacao': float(perda_teste),
        'matrizConfusao': matriz.tolist(),
        'classes': classes,
        'normalizacao': normalizacao,
        'arquitetura': arquitetura,
    }
    log.adicionar('Exportando modelo para TFLite e header C...')
    tflite = exportar.para_tflite(modelo, x_treino, cfg['quantizacao'])
    return tflite, metricas, historico


def _construir_regressao(cfg: dict, entradas: int, log: _Log):
    import tensorflow as tf

    arquitetura = cfg['arquitetura']
    janela = int(cfg['entrada']['janela'])
    canais = int(cfg['entrada']['canais'])
    if arquitetura == 'CNN1D' and entradas != janela * canais:
        log.adicionar(f'Colunas ({entradas}) diferentes de janela×canais ({janela}×{canais}); usando DENSA.')
        arquitetura = 'DENSA'
    elif arquitetura not in ('DENSA', 'CNN1D'):
        log.adicionar(f'Arquitetura {arquitetura} não se aplica à REGRESSAO; usando DENSA.')
        arquitetura = 'DENSA'

    entrada = tf.keras.Input(shape=(entradas,))
    h = entrada
    if arquitetura == 'DENSA':
        for _ in range(int(cfg['camadas'])):
            h = tf.keras.layers.Dense(int(cfg['neuronios']), activation='relu')(h)
            h = tf.keras.layers.Dropout(DROPOUT)(h)
    else:
        h = tf.keras.layers.Reshape((janela, canais))(h)
        for _ in range(int(cfg['camadas'])):
            h = tf.keras.layers.Conv1D(int(cfg['neuronios']), 3, padding='same', activation='relu')(h)
            h = tf.keras.layers.MaxPool1D(2, padding='same')(h)
        h = tf.keras.layers.GlobalAveragePooling1D()(h)

    saida = tf.keras.layers.Dense(1)(h)
    modelo = tf.keras.Model(entrada, saida)
    modelo.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=float(cfg['taxaAprendizado'])),
        loss='mse',
        metrics=['mae'],
    )
    log.adicionar(f'Arquitetura: {arquitetura}, {modelo.count_params()} parâmetros; saída linear, perda MSE.')
    return modelo, arquitetura


def _treinar_regressao(pedido: dict, cfg: dict, log: _Log):
    import pandas as pd
    import tensorflow as tf
    from sklearn.model_selection import train_test_split

    df = pd.read_csv(pedido['dataset']['caminho'])
    if 'rotulo' not in df.columns:
        raise ValueError("CSV sem a coluna 'rotulo'")
    if df.empty:
        raise ValueError('CSV sem amostras')
    try:
        rotulo = pd.to_numeric(df['rotulo'], errors='raise').to_numpy(dtype=np.float64)
    except (ValueError, TypeError) as erro:
        raise ValueError("Na REGRESSAO a coluna 'rotulo' precisa ser numérica") from erro

    atributos = df.drop(columns=['rotulo']).to_numpy(dtype=np.float32)
    media = atributos.mean(axis=0)
    desvio = atributos.std(axis=0)
    desvio[desvio == 0] = 1.0
    x = ((atributos - media) / desvio).astype(np.float32)

    r_media = float(rotulo.mean())
    r_desvio = float(rotulo.std()) or 1.0
    y = ((rotulo - r_media) / r_desvio).astype(np.float32)
    log.adicionar(
        f'Dados: {x.shape[0]} amostras, {x.shape[1]} atributos (normalizados), '
        f'rótulo normalizado (média {r_media:.4f}, desvio {r_desvio:.4f}).'
    )
    x_treino, x_teste, y_treino, y_teste = train_test_split(
        x, y, test_size=PROPORCAO_TESTE, random_state=SEMENTE
    )

    modelo, arquitetura = _construir_regressao(cfg, x.shape[1], log)
    epocas = int(cfg['epocas'])
    lote = int(cfg['tamanhoLote'])
    log.adicionar(f'Treinando: até {epocas} épocas, lote {lote}.')
    historico: list = []
    parada = tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=PACIENCIA, restore_best_weights=True)
    modelo.fit(
        x_treino,
        y_treino,
        validation_data=(x_teste, y_teste),
        epochs=epocas,
        batch_size=lote,
        callbacks=[parada, _criar_log_epocas(tf, log, epocas, historico, 'mae', 'mae')],
        verbose=0,
    )

    previsto = modelo.predict(x_teste, verbose=0).ravel() * r_desvio + r_media
    real = y_teste.astype(np.float64) * r_desvio + r_media
    metricas = metricas_regressao(real, previsto)
    metricas['arquitetura'] = arquitetura
    metricas['normalizacao'] = {
        'atributos': {'media': media.tolist(), 'desvio': desvio.tolist()},
        'rotulo': {'media': r_media, 'desvio': r_desvio},
    }
    log.adicionar(
        f"Validação: MAE={metricas['mae']:.4f} RMSE={metricas['rmse']:.4f} "
        f"R²={metricas['r2']:.4f} (escala original do rótulo)."
    )
    log.adicionar('Exportando modelo para TFLite e header C...')
    tflite = _tflite_regressao(modelo, x_treino, cfg['quantizacao'], log)
    return tflite, metricas, historico


def _treinar_imagem(pedido: dict, cfg: dict, log: _Log):
    import tensorflow as tf

    dataset = pedido['dataset']
    pasta = Path(dataset['caminho'])
    classes = list(dataset.get('classes') or []) or sorted(p.name for p in pasta.iterdir() if p.is_dir())
    if len(classes) < 2:
        raise ValueError('IMAGEM precisa de pelo menos 2 classes (pastas)')

    imagem = cfg['entrada']['imagem']
    altura, largura = int(imagem['altura']), int(imagem['largura'])
    canais = int(imagem['cores'])
    modo = 'grayscale' if canais == 1 else 'rgb'
    lote = int(cfg['tamanhoLote'])
    argumentos = dict(
        image_size=(altura, largura),
        color_mode=modo,
        batch_size=lote,
        validation_split=PROPORCAO_TESTE,
        seed=SEMENTE,
        class_names=classes,
    )
    treino_ds = tf.keras.utils.image_dataset_from_directory(str(pasta), subset='training', **argumentos)
    # shuffle continua o padrão (True): é o embaralhamento com a seed que define o mesmo split de treino/validação.
    # A matriz de confusão fica coerente porque rótulos e previsões são lidos no mesmo laço (abaixo).
    val_ds = tf.keras.utils.image_dataset_from_directory(str(pasta), subset='validation', **argumentos)
    log.adicionar(
        f'Dados: classes {classes}, imagens {altura}×{largura} ({modo}), lote {lote}, '
        f'validação {int(PROPORCAO_TESTE * 100)}%.'
    )
    x_rep = np.stack([x.numpy() for x, _ in treino_ds.unbatch().take(exportar.AMOSTRAS_REPRESENTATIVAS)])
    x_rep = x_rep.astype(np.float32)

    entrada = tf.keras.Input(shape=(altura, largura, canais))
    h = tf.keras.layers.Rescaling(1.0 / 255)(entrada)
    if cfg.get('aumentoDados'):
        h = tf.keras.layers.RandomFlip('horizontal')(h)
        h = tf.keras.layers.RandomRotation(0.05)(h)
    for i in range(int(cfg['camadas'])):
        filtros = min(int(cfg['neuronios']) * 2 ** i, 128)
        h = tf.keras.layers.Conv2D(filtros, 3, padding='same', activation='relu')(h)
        h = tf.keras.layers.MaxPool2D()(h)
    # GlobalMaxPooling destaca o objeto sobre o fundo e converge bem mais rápido que a média com poucas imagens
    # (no dataset de formas: ~96% de acurácia de validação na 5ª época contra ~21% com GlobalAveragePooling).
    h = tf.keras.layers.GlobalMaxPooling2D()(h)
    h = tf.keras.layers.Dropout(DROPOUT)(h)
    saida = tf.keras.layers.Dense(len(classes), activation='softmax')(h)
    modelo = tf.keras.Model(entrada, saida)
    modelo.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=float(cfg['taxaAprendizado'])),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )
    log.adicionar(f'Arquitetura: CNN2D, {modelo.count_params()} parâmetros.')

    epocas = int(cfg['epocas'])
    log.adicionar(f'Treinando: até {epocas} épocas.')
    historico: list = []
    # Com poucas imagens a menor perda de validação costuma cair na 1ª época (rede ainda chutando);
    # restaurar esses pesos devolveria um modelo inútil. Para imagens monitoramos a acurácia de validação.
    parada = tf.keras.callbacks.EarlyStopping(
        monitor='val_accuracy', mode='max', patience=max(PACIENCIA, epocas // 3), restore_best_weights=True
    )
    modelo.fit(
        treino_ds,
        validation_data=val_ds,
        epochs=epocas,
        callbacks=[parada, _criar_log_epocas(tf, log, epocas, historico, 'acuracia', 'accuracy')],
        verbose=0,
    )

    perda_treino, acuracia_treino = modelo.evaluate(treino_ds, verbose=0)
    perda_val, acuracia_val = modelo.evaluate(val_ds, verbose=0)
    # Rótulos e previsões no mesmo laço, lote a lote, para a matriz de confusão ficar coerente.
    reais_lotes, previstos_lotes = [], []
    for x_lote, y_lote in val_ds:
        previstos_lotes.append(np.argmax(modelo.predict(x_lote, verbose=0), axis=1))
        reais_lotes.append(y_lote.numpy())
    y_real = np.concatenate(reais_lotes)
    previsoes = np.concatenate(previstos_lotes)
    matriz = np.zeros((len(classes), len(classes)), dtype=np.int64)
    np.add.at(matriz, (y_real, previsoes), 1)

    metricas = {
        'acuracia': float(acuracia_treino),
        'perda': float(perda_treino),
        'acuraciaValidacao': float(acuracia_val),
        'perdaValidacao': float(perda_val),
        'matrizConfusao': matriz.tolist(),
        'classes': classes,
        'arquitetura': 'CNN2D',
    }
    log.adicionar('Exportando modelo para TFLite e header C...')
    tflite = exportar.para_tflite(modelo, x_rep, cfg['quantizacao'])
    return tflite, metricas, historico


# ---------------------------------------------------------------- ponto de entrada

def executar_tinyml(pedido: dict, enviar) -> None:
    """Treina o modelo TinyML do pedido. Lança exceção em erro (quem trata é app.modelos.executar)."""
    tarefa = pedido['tarefa']
    cfg = pedido['config']
    saida = Path(pedido['saidaDir'])
    saida.mkdir(parents=True, exist_ok=True)
    log = _Log(enviar)
    log.adicionar(
        f"TINYML {tarefa}: arquitetura {cfg.get('arquitetura')}, quantização {cfg.get('quantizacao')}, "
        f"{cfg.get('epocas')} épocas."
    )

    if tarefa == 'CLASSIFICACAO':
        tflite, metricas, historico = _treinar_classificacao(pedido, cfg, log)
    elif tarefa == 'REGRESSAO':
        tflite, metricas, historico = _treinar_regressao(pedido, cfg, log)
    elif tarefa == 'IMAGEM':
        tflite, metricas, historico = _treinar_imagem(pedido, cfg, log)
    else:
        raise ValueError(f'Tarefa TINYML desconhecida: {tarefa}')

    tamanho_kb = len(tflite) / 1024
    log.adicionar(f'Modelo TFLite: {len(tflite)} bytes ({tamanho_kb:.1f} KB).')
    limite_flash = cfg.get('limiteFlashKb')
    if limite_flash and tamanho_kb > float(limite_flash):
        log.adicionar(f'ALERTA: o modelo ({tamanho_kb:.1f} KB) passa do limite de flash da placa ({limite_flash} KB).')

    cabecalho = exportar.para_header_c(tflite, 'g_model')
    caminho_tflite = saida / 'model.tflite'
    caminho_h = saida / 'model_data.h'
    caminho_metricas = saida / 'metricas.json'
    caminho_tflite.write_bytes(tflite)
    caminho_h.write_text(cabecalho, encoding='utf-8')

    metricas['historico'] = historico
    metricas['principal'] = escolher_principal(tarefa, metricas)
    caminho_metricas.write_text(json.dumps(metricas, ensure_ascii=False, indent=2), encoding='utf-8')

    artefatos = montar_artefatos(
        [
            ('model.tflite', 'TFLITE', caminho_tflite),
            ('model_data.h', 'HEADER_C', caminho_h),
            ('metricas.json', 'METRICAS', caminho_metricas),
        ],
        DATA_DIR,
    )
    log.adicionar('Artefatos gravados: model.tflite, model_data.h, metricas.json.')
    log.adicionar('Treino concluído com sucesso.')

    (saida / ARQUIVO_FINAL).write_text('SUCESSO', encoding='utf-8')
    log.enviar('SUCESSO', metricas=metricas, artefatos=artefatos)
