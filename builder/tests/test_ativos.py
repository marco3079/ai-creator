import os
import sys
import threading

# Permite importar o pacote `app` ao rodar `python -m pytest` a partir da pasta do serviço.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from app import ativos  # noqa: E402


@pytest.fixture(autouse=True)
def limpar():
    for tipo in ativos.TIPOS:
        for id_ in ativos.listar()[tipo]:
            ativos.desmarcar(tipo, id_)
    yield


def test_listar_tem_as_tres_chaves_vazias():
    assert ativos.listar() == {'treinos': [], 'treinosModelo': [], 'builds': []}


def test_marcar_e_desmarcar():
    ativos.marcar('builds', 7)
    ativos.marcar('builds', 3)
    assert ativos.listar()['builds'] == [3, 7]
    ativos.desmarcar('builds', 7)
    assert ativos.listar()['builds'] == [3]


def test_marcar_e_idempotente_e_desmarcar_ausente_nao_falha():
    ativos.marcar('builds', 1)
    ativos.marcar('builds', 1)
    assert ativos.listar()['builds'] == [1]
    ativos.desmarcar('builds', 99)
    ativos.desmarcar('builds', 1)
    ativos.desmarcar('builds', 1)
    assert ativos.listar()['builds'] == []


def test_tipos_sao_independentes():
    ativos.marcar('builds', 5)
    ativos.marcar('treinos', 5)
    ativos.desmarcar('builds', 5)
    assert ativos.listar() == {'treinos': [5], 'treinosModelo': [], 'builds': []}


def test_marcacoes_em_threads_nao_se_perdem():
    def marcar_muitos(base):
        for i in range(base, base + 200):
            ativos.marcar('builds', i)

    threads = [threading.Thread(target=marcar_muitos, args=(n * 200,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert ativos.listar()['builds'] == list(range(1600))

    def desmarcar_muitos(base):
        for i in range(base, base + 200):
            ativos.desmarcar('builds', i)

    threads = [threading.Thread(target=desmarcar_muitos, args=(n * 200,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert ativos.listar()['builds'] == []
