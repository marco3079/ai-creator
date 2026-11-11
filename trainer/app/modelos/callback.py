"""Envio de callbacks do trainer ao servidor (rotas internas /interno/treinos-modelo/:id)."""

import sys

import httpx

TIMEOUT_SEGUNDOS = 30


def criar_enviador(url: str, token: str):
    """Devolve `enviar(**campos)`, que posta os campos (status, log, metricas, artefatos...) ao servidor.

    Nunca lança: falha de rede ou resposta de erro só é registrada no stderr.
    """

    def enviar(**campos) -> None:
        try:
            resposta = httpx.post(
                url,
                json=campos,
                headers={'X-Interno-Token': token},
                timeout=TIMEOUT_SEGUNDOS,
            )
            if resposta.status_code >= 300:
                print(
                    f'Callback do treino respondeu {resposta.status_code} ({campos.get("status")})',
                    file=sys.stderr,
                    flush=True,
                )
        except Exception as erro:  # noqa: BLE001 - o callback nunca pode derrubar o treino
            print(f'Falha no callback do treino ({campos.get("status")}): {erro}', file=sys.stderr, flush=True)

    return enviar
