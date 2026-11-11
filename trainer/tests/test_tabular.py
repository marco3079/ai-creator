import json
from pathlib import Path

import numpy as np
import pandas as pd

from app.modelos.tabular import executar_tabular


class Enviador:
    """Substitui o callback HTTP: acumula cada chamada para inspeção."""

    def __init__(self):
        self.chamadas: list[dict] = []

    def __call__(self, **campos):
        self.chamadas.append(campos)

    def log(self) -> str:
        return ''.join(c.get('log', '') for c in self.chamadas)

    def final(self) -> dict:
        return self.chamadas[-1]


def _csv_classificacao(caminho: Path) -> Path:
    rng = np.random.default_rng(0)
    a = rng.normal(size=160)
    b = rng.normal(size=160)
    rotulo = np.where(a + b + rng.normal(scale=0.2, size=160) > 0, 'sim', 'nao')
    pd.DataFrame({'a': a, 'b': b, 'rotulo': rotulo}).to_csv(caminho, index=False)
    return caminho


def _csv_multiclasse(caminho: Path) -> Path:
    rng = np.random.default_rng(2)
    a = rng.normal(size=240)
    b = rng.normal(size=240)
    rotulo = np.select([a > 0.5, a < -0.5], ['alto', 'baixo'], 'medio')
    pd.DataFrame({'a': a, 'b': b, 'rotulo': rotulo}).to_csv(caminho, index=False)
    return caminho


def _csv_regressao(caminho: Path) -> Path:
    rng = np.random.default_rng(1)
    a = rng.normal(size=160)
    b = rng.normal(size=160)
    y = 2 * a - b + rng.normal(scale=0.1, size=160)
    pd.DataFrame({'a': a, 'b': b, 'rotulo': y}).to_csv(caminho, index=False)
    return caminho


def _pedido(tmp_path: Path, csv: Path, tarefa: str, config: dict) -> dict:
    saida = tmp_path / 'saida'
    return {
        'treinoId': 1,
        'tipo': 'TABULAR',
        'tarefa': tarefa,
        'dataset': {'tipo': 'TABELA', 'caminho': str(csv), 'classes': []},
        'saidaDir': str(saida),
        'config': config,
        'callbackUrl': 'http://teste/interno',
        'callbackToken': 'x',
    }


def test_arvore_classificacao_gera_metricas_e_header(tmp_path):
    csv = _csv_classificacao(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'CLASSIFICACAO',
        {
            'algoritmo': 'ARVORE',
            'hiperparametros': {'max_depth': '4', 'chave_inexistente': 1},
            'testeFracao': 0.25,
            'validacaoCruzada': 3,
            'normalizar': True,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    final = enviar.final()
    assert final['status'] == 'SUCESSO'
    metricas = final['metricas']
    assert metricas['acuracia'] > 0.8
    assert metricas['principal']['nome'] == 'acuracia'
    assert metricas['principal']['formato'] == 'percentual'
    assert set(metricas['classes']) == {'nao', 'sim'}
    assert metricas['validacaoCruzada']['k'] == 3
    assert 'chave_inexistente' in enviar.log()

    nomes = {a['nome'] for a in final['artefatos']}
    assert {'modelo.joblib', 'modelo_tabular.h', 'metricas.json'} <= nomes
    header = (tmp_path / 'saida' / 'modelo_tabular.h').read_text(encoding='utf-8')
    assert '#pragma once' in header
    assert 'aic_prever(' in header
    assert 'aic_normalizar(' in header
    assert '#define AIC_N_SAIDAS 2' in header
    assert (tmp_path / 'saida' / '.final').read_text(encoding='utf-8') == 'SUCESSO'
    assert json.loads((tmp_path / 'saida' / 'metricas.json').read_text(encoding='utf-8'))['acuracia'] > 0.8


def test_random_forest_regressao_gera_r2_e_header(tmp_path):
    csv = _csv_regressao(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'REGRESSAO',
        {
            'algoritmo': 'RANDOM_FOREST',
            'hiperparametros': {'n_estimators': 20, 'max_depth': 6},
            'testeFracao': 0.2,
            'validacaoCruzada': 0,
            'normalizar': False,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    final = enviar.final()
    assert final['status'] == 'SUCESSO'
    assert final['metricas']['r2'] > 0.8
    assert final['metricas']['principal'] == {
        'nome': 'r2',
        'rotulo': 'R²',
        'valor': final['metricas']['r2'],
        'formato': 'numero',
    }
    assert 'validacaoCruzada' not in final['metricas']
    header = (tmp_path / 'saida' / 'modelo_tabular.h').read_text(encoding='utf-8')
    assert '#pragma once' in header
    assert 'aic_prever(' in header
    assert 'aic_normalizar' not in header
    assert '#define AIC_N_SAIDAS 1' in header


def test_knn_avisa_e_nao_gera_header(tmp_path):
    csv = _csv_classificacao(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'CLASSIFICACAO',
        {
            'algoritmo': 'KNN',
            'hiperparametros': {'n_neighbors': 5},
            'testeFracao': 0.2,
            'validacaoCruzada': 0,
            'normalizar': True,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    final = enviar.final()
    assert final['status'] == 'SUCESSO'
    nomes = {a['nome'] for a in final['artefatos']}
    assert 'modelo_tabular.h' not in nomes
    assert 'modelo.joblib' in nomes
    assert 'não tem exportação para C' in enviar.log()
    assert not (tmp_path / 'saida' / 'modelo_tabular.h').exists()


def _header_de(tmp_path: Path, enviar: Enviador) -> str:
    return (tmp_path / 'saida' / 'modelo_tabular.h').read_text(encoding='utf-8')


def test_arvore_tres_classes_saidas_3(tmp_path):
    csv = _csv_multiclasse(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'CLASSIFICACAO',
        {
            'algoritmo': 'ARVORE',
            'hiperparametros': {'max_depth': 4},
            'testeFracao': 0.2,
            'validacaoCruzada': 0,
            'normalizar': False,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    assert enviar.final()['status'] == 'SUCESSO'
    header = _header_de(tmp_path, enviar)
    assert '#define AIC_N_SAIDAS 3' in header
    assert '#define AIC_N_CLASSES 3' in header


def test_logistica_binaria_saidas_1(tmp_path):
    csv = _csv_classificacao(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'CLASSIFICACAO',
        {
            'algoritmo': 'LOGISTICA',
            'hiperparametros': {'C': 1.0, 'max_iter': 1000},
            'testeFracao': 0.2,
            'validacaoCruzada': 0,
            'normalizar': True,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    assert enviar.final()['status'] == 'SUCESSO'
    header = _header_de(tmp_path, enviar)
    assert '#define AIC_N_SAIDAS 1' in header
    assert '#define AIC_N_CLASSES 2' in header


def test_linear_regressao_saidas_1(tmp_path):
    csv = _csv_regressao(tmp_path / 'dados.csv')
    pedido = _pedido(
        tmp_path,
        csv,
        'REGRESSAO',
        {
            'algoritmo': 'LINEAR',
            'hiperparametros': {'alpha': 1.0},
            'testeFracao': 0.2,
            'validacaoCruzada': 0,
            'normalizar': True,
            'exportarC': True,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    assert enviar.final()['status'] == 'SUCESSO'
    header = _header_de(tmp_path, enviar)
    assert '#define AIC_N_SAIDAS 1' in header
    assert 'AIC_N_CLASSES' not in header


def test_validacao_cruzada_grande_demais_ignorada(tmp_path):
    csv = tmp_path / 'pequeno.csv'
    pd.DataFrame(
        {'a': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 'rotulo': ['x', 'y'] * 4}
    ).to_csv(csv, index=False)
    pedido = _pedido(
        tmp_path,
        csv,
        'CLASSIFICACAO',
        {
            'algoritmo': 'ARVORE',
            'hiperparametros': {'max_depth': 2},
            'testeFracao': 0.25,
            'validacaoCruzada': 10,
            'normalizar': False,
            'exportarC': False,
        },
    )
    enviar = Enviador()
    executar_tabular(pedido, enviar)

    final = enviar.final()
    assert final['status'] == 'SUCESSO'
    assert 'validacaoCruzada' not in final['metricas']
    assert 'Validação cruzada ignorada' in enviar.log()
