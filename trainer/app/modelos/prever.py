"""Previsão síncrona com um modelo já treinado (POST /modelos/prever).

Funções puras (validar_quantidade, normalizar, quantizar, desquantizar,
ordenar_probabilidades, montar_classificacao, montar_regressao) não importam
TensorFlow nem joblib: podem ser testadas sem eles. TensorFlow e joblib entram
só dentro de _prever_tinyml e _prever_tabular.

Resultado no formato ResultadoPrevisao (client/src/lib/tipos-melhorias.ts):
classe, probabilidades (ordenadas da maior para a menor), valor, saidaBruta,
latenciaMs (só o tempo de inferência, do invoke() ou do predict()), avisos.
"""

import base64
import json
import math
import time
import warnings
from pathlib import Path

import numpy as np


class EntradaInvalida(ValueError):
    """Pedido ou entrada inválidos: o router responde HTTP 400 com a mensagem em português."""


class Indisponivel(RuntimeError):
    """Recurso que este trainer ainda não tem (ex.: áudio sem o módulo de áudio): HTTP 501."""


TAREFAS_TINYML = ('CLASSIFICACAO', 'REGRESSAO', 'IMAGEM', 'AUDIO')
TAREFAS_TABULAR = ('CLASSIFICACAO', 'REGRESSAO')


# ---------------------------------------------------------------- funções puras

def validar_quantidade(valores: list[float], esperados: int) -> None:
    if len(valores) != esperados:
        raise EntradaInvalida(f'Esperados {esperados} valores de entrada, recebidos {len(valores)}.')


def normalizar(valores: list[float], media: list[float], desvio: list[float]) -> list[float]:
    """Mesma normalização do treino: (valor - média) / desvio, coluna a coluna."""
    if len(media) != len(desvio):
        raise ValueError('Normalização inconsistente: média e desvio com tamanhos diferentes.')
    validar_quantidade(valores, len(media))
    return [(v - m) / d for v, m, d in zip(valores, media, desvio)]


def quantizar(valores, escala: float, ponto_zero: int, tipo) -> np.ndarray:
    """Float → inteiro do tensor: q = round(x / escala) + ponto_zero, limitado ao intervalo do tipo."""
    info = np.iinfo(tipo)
    q = np.round(np.asarray(valores, dtype=np.float64) / escala) + ponto_zero
    return np.clip(q, info.min, info.max).astype(tipo)


def desquantizar(quantizados, escala: float, ponto_zero: int) -> list[float]:
    """Inteiro do tensor → float: x = (q - ponto_zero) × escala."""
    q = np.asarray(quantizados, dtype=np.int64)
    return [float(v) for v in (q - ponto_zero) * escala]


def valor_regressao(saida: float, media: float, desvio: float) -> float:
    """Desnormaliza a saída de REGRESSAO: valor = saída × desvio + média (escala do rótulo)."""
    return float(saida) * desvio + media


def ordenar_probabilidades(classes: list[str], valores) -> list[dict]:
    """[{classe, valor}] da maior probabilidade para a menor."""
    pares = sorted(zip(classes, (float(v) for v in valores)), key=lambda par: par[1], reverse=True)
    return [{'classe': classe, 'valor': valor} for classe, valor in pares]


def montar_classificacao(classes: list[str], saida, latencia_ms: float, avisos: list[str]) -> dict:
    if len(classes) != len(saida):
        raise ValueError(f'O modelo devolveu {len(saida)} valores para {len(classes)} classes.')
    probabilidades = ordenar_probabilidades(classes, saida)
    return {
        'classe': probabilidades[0]['classe'],
        'probabilidades': probabilidades,
        'saidaBruta': [float(v) for v in saida],
        'latenciaMs': round(latencia_ms, 3),
        'avisos': avisos,
    }


def montar_regressao(valor: float, saida, latencia_ms: float, avisos: list[str]) -> dict:
    return {
        'valor': float(valor),
        'saidaBruta': [float(v) for v in saida],
        'latenciaMs': round(latencia_ms, 3),
        'avisos': avisos,
    }


# ---------------------------------------------------------------- auxiliares

def prever(pedido: dict) -> dict:
    """Ponto de entrada. `pedido` é PedidoPrever.model_dump() (ver trainer/app/main.py)."""
    tipo = pedido['tipo']
    tarefa = pedido['tarefa']
    if tipo == 'TINYML':
        if tarefa not in TAREFAS_TINYML:
            raise EntradaInvalida(f'Tarefa {tarefa} não se aplica ao TINYML.')
        return _prever_tinyml(pedido)
    if tipo == 'TABULAR':
        if tarefa not in TAREFAS_TABULAR:
            raise EntradaInvalida(f'Tarefa {tarefa} não se aplica ao TABULAR.')
        return _prever_tabular(pedido)
    raise EntradaInvalida(f'Tipo de modelo desconhecido: {tipo}.')


def valores_de(entrada: dict) -> list[float]:
    valores = entrada.get('valores')
    if not valores:
        raise EntradaInvalida('Informe os valores de entrada (entrada.valores).')
    if not all(math.isfinite(v) for v in valores):
        raise EntradaInvalida('Os valores de entrada precisam ser números finitos.')
    return list(valores)


def _decodificar_base64(texto: str, nome: str) -> bytes:
    try:
        conteudo = base64.b64decode(texto.strip())
    except (ValueError, TypeError) as erro:
        raise EntradaInvalida(f'O conteúdo de {nome} não está em base64.') from erro
    if not conteudo:
        raise EntradaInvalida(f'O conteúdo de {nome} está vazio.')
    return conteudo


def _ler_metricas(caminho: str) -> dict:
    return json.loads(Path(caminho).read_text(encoding='utf-8'))


def _para_tensor(x, detalhe: dict) -> np.ndarray:
    """Ajusta a entrada à forma e ao tipo do tensor do TFLite (int8 com scale/zero_point, ou float32)."""
    forma = [int(d) for d in detalhe['shape']]
    arr = np.asarray(x, dtype=np.float64)
    esperados = int(np.prod(forma))
    if arr.size != esperados:
        raise EntradaInvalida(f'O modelo espera uma entrada com {esperados} valores, recebeu {arr.size}.')
    tipo = detalhe['dtype']
    escala, ponto_zero = detalhe.get('quantization', (0.0, 0))
    if np.issubdtype(tipo, np.integer) and escala:
        return quantizar(arr, escala, ponto_zero, tipo).reshape(forma)
    return arr.astype(tipo).reshape(forma)


def _saida_real(bruta, detalhe: dict) -> list[float]:
    escala, ponto_zero = detalhe.get('quantization', (0.0, 0))
    if np.issubdtype(detalhe['dtype'], np.integer) and escala:
        return desquantizar(bruta, escala, ponto_zero)
    return [float(v) for v in np.asarray(bruta).ravel()]


def _imagem_para_tensor(entrada: dict, cfg: dict, tf) -> np.ndarray:
    """Decodifica, converte para os canais do treino e redimensiona. Entrada na faixa 0-255 (o modelo tem Rescaling)."""
    if not entrada.get('imagemBase64'):
        raise EntradaInvalida('Envie a imagem (entrada.imagemBase64).')
    conteudo = _decodificar_base64(entrada['imagemBase64'], 'a imagem')
    imagem = cfg['entrada']['imagem']
    try:
        img = tf.io.decode_image(conteudo, channels=int(imagem['cores']), expand_animations=False)
    except tf.errors.OpError as erro:
        raise EntradaInvalida('Não foi possível ler a imagem enviada.') from erro
    img = tf.image.resize(tf.cast(img, tf.float32), (int(imagem['altura']), int(imagem['largura'])))
    return img.numpy()


def _audio_para_features(entrada: dict, cfg: dict) -> np.ndarray:
    if not entrada.get('audioBase64'):
        raise EntradaInvalida('Envie o áudio (entrada.audioBase64).')
    wav = _decodificar_base64(entrada['audioBase64'], 'o áudio')
    try:
        from app.modelos.audio import extrair_features_audio  # escrito pelo A10; importado só aqui
    except ImportError as erro:
        raise Indisponivel('Classificação de áudio ainda não está disponível neste serviço.') from erro
    try:
        return extrair_features_audio(wav, cfg['entrada']['audio'])
    except ValueError as erro:
        raise EntradaInvalida('Não foi possível ler o áudio (esperado um .wav PCM).') from erro


# ---------------------------------------------------------------- TINYML

def _prever_tinyml(pedido: dict) -> dict:
    import tensorflow as tf

    tarefa = pedido['tarefa']
    cfg = pedido['config']
    artefatos = pedido['artefatos']
    if not artefatos.get('tflite'):
        raise EntradaInvalida('Este modelo não tem arquivo TFLite.')
    metricas = _ler_metricas(artefatos['metricas'])
    entrada = pedido['entrada']

    if tarefa == 'IMAGEM':
        x = _imagem_para_tensor(entrada, cfg, tf)
    elif tarefa == 'AUDIO':
        # Sem normalização: o treino de áudio (A10) grava a normalização em metricas.json se houver.
        x = _audio_para_features(entrada, cfg)
    elif tarefa == 'CLASSIFICACAO':
        norm = metricas['normalizacao']
        x = normalizar(valores_de(entrada), norm['media'], norm['desvio'])
    else:  # REGRESSAO
        norm = metricas['normalizacao']['atributos']
        x = normalizar(valores_de(entrada), norm['media'], norm['desvio'])

    interpretador = tf.lite.Interpreter(model_path=artefatos['tflite'])
    interpretador.allocate_tensors()
    detalhe_entrada = interpretador.get_input_details()[0]
    detalhe_saida = interpretador.get_output_details()[0]

    interpretador.set_tensor(detalhe_entrada['index'], _para_tensor(x, detalhe_entrada))
    inicio = time.perf_counter()
    interpretador.invoke()
    latencia_ms = (time.perf_counter() - inicio) * 1000
    saida = _saida_real(interpretador.get_tensor(detalhe_saida['index'])[0], detalhe_saida)

    avisos: list[str] = []
    if tarefa == 'REGRESSAO':
        rotulo = metricas['normalizacao']['rotulo']
        valor = valor_regressao(saida[0], rotulo['media'], rotulo['desvio'])
        return montar_regressao(valor, saida, latencia_ms, avisos)
    return montar_classificacao(metricas['classes'], saida, latencia_ms, avisos)


# ---------------------------------------------------------------- TABULAR

def _prever_tabular(pedido: dict) -> dict:
    import joblib

    tarefa = pedido['tarefa']
    if not pedido['artefatos'].get('joblib'):
        raise EntradaInvalida('Este modelo não tem arquivo joblib.')
    valores = valores_de(pedido['entrada'])
    modelo = joblib.load(pedido['artefatos']['joblib'])
    esperados = getattr(modelo, 'n_features_in_', None)
    if esperados is not None:
        validar_quantidade(valores, int(esperados))
    x = np.asarray([valores], dtype=np.float64)
    avisos: list[str] = []

    with warnings.catch_warnings():
        # O modelo foi treinado com DataFrame; aqui a entrada chega como lista, na mesma ordem do CSV.
        warnings.filterwarnings('ignore', message='X does not have valid feature names')

        if tarefa == 'REGRESSAO':
            inicio = time.perf_counter()
            valor = float(modelo.predict(x)[0])
            latencia_ms = (time.perf_counter() - inicio) * 1000
            return montar_regressao(valor, [valor], latencia_ms, avisos)

        classes = [str(c) for c in modelo.classes_]
        inicio = time.perf_counter()
        try:
            probabilidades = modelo.predict_proba(x)[0]
        except AttributeError:
            # SVM sem probability=True (ou modelo sem predict_proba): só a classe.
            probabilidades = None
        if probabilidades is None:
            classe = str(modelo.predict(x)[0])
            latencia_ms = (time.perf_counter() - inicio) * 1000
            avisos.append('Este modelo não calcula probabilidades: só a classe prevista.')
            return {'classe': classe, 'saidaBruta': [], 'latenciaMs': round(latencia_ms, 3), 'avisos': avisos}
        latencia_ms = (time.perf_counter() - inicio) * 1000
        return montar_classificacao(classes, probabilidades.tolist(), latencia_ms, avisos)
