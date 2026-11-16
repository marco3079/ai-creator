import os
import sys

# Permite importar o pacote `app` ao rodar `python -m pytest` a partir da pasta trainer/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from app.modelos import prever  # noqa: E402


def test_importar_prever_nao_carrega_tensorflow():
    # TensorFlow e joblib entram só dentro de _prever_tinyml e _prever_tabular.
    assert 'tensorflow' not in sys.modules


def test_normalizar_usa_media_e_desvio_do_treino():
    assert prever.normalizar([3.0, 10.0], [1.0, 4.0], [2.0, 3.0]) == [1.0, 2.0]


def test_normalizar_quantidade_errada_da_400():
    with pytest.raises(prever.EntradaInvalida) as erro:
        prever.normalizar([1.0], [0.0, 0.0], [1.0, 1.0])
    assert 'Esperados 2 valores de entrada, recebidos 1.' in str(erro.value)


def test_quantizar_com_scale_e_zero_point_de_exemplo():
    # scale 0.5, zero_point -3: q = round(x / 0.5) - 3
    q = prever.quantizar([0.0, 1.0, -1.0, 2.25], 0.5, -3, np.int8)
    assert q.dtype == np.int8
    assert q.tolist() == [-3, -1, -5, 1]


def test_quantizar_satura_no_intervalo_do_tipo():
    q = prever.quantizar([1000.0, -1000.0], 0.5, 0, np.int8)
    assert q.tolist() == [127, -128]


def test_desquantizar_inverte_a_quantizacao():
    valores = prever.desquantizar(np.array([-3, -1, -5, 1], dtype=np.int8), 0.5, -3)
    assert valores == [0.0, 1.0, -1.0, 2.0]


def test_desquantizar_nao_estoura_com_int8():
    # -128 - (-3) em int8 daria overflow; a conta é feita em int64.
    assert prever.desquantizar(np.array([-128], dtype=np.int8), 1.0, 0) == [-128.0]


def test_valor_regressao_desnormaliza():
    assert prever.valor_regressao(0.5, 10.0, 4.0) == 12.0


def test_ordenar_probabilidades_da_maior_para_a_menor():
    ordenadas = prever.ordenar_probabilidades(['a', 'b', 'c'], [0.2, 0.7, 0.1])
    assert [p['classe'] for p in ordenadas] == ['b', 'a', 'c']
    assert ordenadas[0] == {'classe': 'b', 'valor': 0.7}


def test_montar_classificacao_monta_resultado():
    resultado = prever.montar_classificacao(['sim', 'nao'], [0.25, 0.75], 1.23456, [])
    assert resultado['classe'] == 'nao'
    assert resultado['probabilidades'] == [
        {'classe': 'nao', 'valor': 0.75},
        {'classe': 'sim', 'valor': 0.25},
    ]
    assert resultado['saidaBruta'] == [0.25, 0.75]
    assert resultado['latenciaMs'] == 1.235
    assert resultado['avisos'] == []


def test_montar_classificacao_classes_e_saida_de_tamanhos_diferentes():
    with pytest.raises(ValueError):
        prever.montar_classificacao(['a', 'b'], [1.0], 0.0, [])


def test_montar_regressao_inclui_valor_e_saida():
    resultado = prever.montar_regressao(12.0, [0.5], 2.0, ['aviso'])
    assert resultado == {'valor': 12.0, 'saidaBruta': [0.5], 'latenciaMs': 2.0, 'avisos': ['aviso']}


def test_valores_de_rejeita_vazio_e_nao_finito():
    with pytest.raises(prever.EntradaInvalida):
        prever.valores_de({'valores': []})
    with pytest.raises(prever.EntradaInvalida):
        prever.valores_de({})
    with pytest.raises(prever.EntradaInvalida):
        prever.valores_de({'valores': [1.0, float('nan')]})


def test_prever_rejeita_tarefa_que_nao_se_aplica_ao_tabular():
    pedido = {
        'tipo': 'TABULAR',
        'tarefa': 'IMAGEM',
        'artefatos': {'metricas': 'x.json'},
        'config': {},
        'entrada': {'valores': [1.0]},
    }
    with pytest.raises(prever.EntradaInvalida):
        prever.prever(pedido)


def test_prever_rejeita_tipo_desconhecido():
    with pytest.raises(prever.EntradaInvalida):
        prever.prever({'tipo': 'OUTRO', 'tarefa': 'CLASSIFICACAO', 'artefatos': {}, 'config': {}, 'entrada': {}})
