"""Exportação do modelo Keras para TFLite e para header C.

O TensorFlow e o numpy são importados dentro de `para_tflite`, para que
`para_header_c` (puro Python) possa ser testado sem instalar o TensorFlow.
"""

from typing import Any

QUANTIZACOES = ('INT8', 'FLOAT32')
AMOSTRAS_REPRESENTATIVAS = 100
BYTES_POR_LINHA = 12


def para_tflite(modelo: Any, x_rep: Any, quantizacao: str) -> bytes:
    """Converte o modelo Keras para TFLite.

    INT8: quantização completa com dataset representativo (primeiras 100
    amostras de `x_rep`), entrada e saída int8.
    FLOAT32: conversão sem otimização.
    """
    import numpy as np
    import tensorflow as tf

    if quantizacao not in QUANTIZACOES:
        raise ValueError(f'Quantização desconhecida: {quantizacao}')

    conversor = tf.lite.TFLiteConverter.from_keras_model(modelo)

    if quantizacao == 'INT8':
        amostras = np.asarray(x_rep, dtype=np.float32)[:AMOSTRAS_REPRESENTATIVAS]

        def dataset_representativo():
            for i in range(len(amostras)):
                yield [amostras[i:i + 1]]

        conversor.optimizations = [tf.lite.Optimize.DEFAULT]
        conversor.representative_dataset = dataset_representativo
        conversor.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        conversor.inference_input_type = tf.int8
        conversor.inference_output_type = tf.int8

    return conversor.convert()


def para_header_c(dados: bytes, nome: str = 'g_model') -> str:
    """Gera o conteúdo de um header C com os bytes do modelo (12 bytes por linha)."""
    linhas = []
    for i in range(0, len(dados), BYTES_POR_LINHA):
        bloco = dados[i:i + BYTES_POR_LINHA]
        linhas.append('  ' + ', '.join(f'0x{b:02x}' for b in bloco))
    corpo = ',\n'.join(linhas)

    return (
        '// Modelo TinyML gerado automaticamente pelo trainer do AI Creator. Não editar.\n'
        '#pragma once\n'
        '\n'
        f'alignas(16) const unsigned char {nome}[] = {{\n'
        f'{corpo}\n'
        '};\n'
        f'const unsigned int {nome}_len = {len(dados)};\n'
    )
