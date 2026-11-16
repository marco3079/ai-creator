"""Trabalhos em andamento neste serviço (GET /trabalhos).

Cada serviço guarda um conjunto de ids por tipo. O id entra quando o pedido é aceito
e sai no `finally` da tarefa em segundo plano (depois que o processo filho terminou).
O servidor usa esta lista na vigia: um EXECUTANDO que não está aqui foi perdido.
"""

import threading

TIPOS = ('treinos', 'treinosModelo', 'builds')

_trava = threading.Lock()
_ativos: dict[str, set[int]] = {tipo: set() for tipo in TIPOS}


def marcar(tipo: str, id: int) -> None:
    """Marca um trabalho como em andamento. `tipo` é uma das chaves de TIPOS."""
    with _trava:
        _ativos[tipo].add(id)


def desmarcar(tipo: str, id: int) -> None:
    """Tira o trabalho da lista de ativos. Não falha se o id não estiver lá."""
    with _trava:
        _ativos[tipo].discard(id)


def listar() -> dict:
    """Ids ativos por tipo: {'treinos': [...], 'treinosModelo': [...], 'builds': [...]}."""
    with _trava:
        return {tipo: sorted(ids) for tipo, ids in _ativos.items()}
