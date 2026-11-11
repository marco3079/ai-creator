import sys

import pytest

from app.modelos import tinyml


def test_importar_tinyml_nao_carrega_tensorflow():
    # O TensorFlow é importado só dentro das funções que precisam dele.
    assert 'tensorflow' not in sys.modules


def test_metricas_regressao_valores_exatos():
    real = [1.0, 2.0, 3.0, 4.0]
    previsto = [1.0, 2.0, 3.0, 4.0]
    assert tinyml.metricas_regressao(real, previsto) == {'mae': 0.0, 'rmse': 0.0, 'r2': 1.0}


def test_metricas_regressao_erro_constante():
    real = [1.0, 2.0, 3.0, 4.0]
    previsto = [2.0, 3.0, 4.0, 5.0]
    m = tinyml.metricas_regressao(real, previsto)
    assert m['mae'] == pytest.approx(1.0)
    assert m['rmse'] == pytest.approx(1.0)
    # ss_res = 4, ss_tot = 5 -> R² = 0.2
    assert m['r2'] == pytest.approx(0.2)


def test_metricas_regressao_alvo_constante():
    m = tinyml.metricas_regressao([5.0, 5.0], [5.0, 5.0])
    assert m['r2'] == 1.0
    m = tinyml.metricas_regressao([5.0, 5.0], [4.0, 6.0])
    assert m['r2'] == 0.0


def test_escolher_principal_regressao_usa_r2():
    principal = tinyml.escolher_principal('REGRESSAO', {'r2': 0.9, 'mae': 1.0})
    assert principal == {'nome': 'r2', 'rotulo': 'R²', 'valor': 0.9, 'formato': 'numero'}


@pytest.mark.parametrize('tarefa', ['CLASSIFICACAO', 'IMAGEM'])
def test_escolher_principal_classificacao_usa_acuracia_validacao_em_percentual(tarefa):
    principal = tinyml.escolher_principal(tarefa, {'acuraciaValidacao': 0.925})
    assert principal['nome'] == 'acuraciaValidacao'
    assert principal['rotulo'] == 'Acurácia (val.)'
    assert principal['formato'] == 'percentual'
    assert principal['valor'] == pytest.approx(92.5)


def test_montar_artefatos_relativos_e_com_tamanho(tmp_path):
    pasta = tmp_path / 'modelos' / '1' / 'treinos' / '2'
    pasta.mkdir(parents=True)
    tflite = pasta / 'model.tflite'
    tflite.write_bytes(b'\x00' * 10)
    cabecalho = pasta / 'model_data.h'
    cabecalho.write_text('abc', encoding='utf-8')

    artefatos = tinyml.montar_artefatos(
        [('model.tflite', 'TFLITE', tflite), ('model_data.h', 'HEADER_C', cabecalho)],
        str(tmp_path),
    )

    assert artefatos == [
        {
            'nome': 'model.tflite',
            'tipo': 'TFLITE',
            'caminho': 'modelos/1/treinos/2/model.tflite',
            'tamanhoBytes': 10,
        },
        {
            'nome': 'model_data.h',
            'tipo': 'HEADER_C',
            'caminho': 'modelos/1/treinos/2/model_data.h',
            'tamanhoBytes': 3,
        },
    ]
