"""Execução de treinos de modelos (TINYML e TABULAR) em processo filho.

O treino roda em um processo `spawn`, para que uma falha nativa (ex.: abort do
TFLite) não derrube o uvicorn. Protocolo com o pai:
- o filho grava `<saidaDir>/.final` (SUCESSO ou FALHA) antes de mandar o callback final;
- se o pai, depois do join(), não achar o `.final`, manda FALHA.
"""

import logging
import multiprocessing
import traceback
from pathlib import Path

from app.modelos.callback import criar_enviador

logger = logging.getLogger(__name__)

ARQUIVO_FINAL = '.final'


def executar(pedido: dict) -> None:
    """Ponto de entrada (BackgroundTasks). Nunca lança exceção."""
    saida = Path(pedido['saidaDir'])
    try:
        saida.mkdir(parents=True, exist_ok=True)
        (saida / ARQUIVO_FINAL).unlink(missing_ok=True)
    except OSError as erro:
        logger.error('Não foi possível preparar %s: %s', saida, erro)

    contexto = multiprocessing.get_context('spawn')
    processo = contexto.Process(target=_executar_filho, args=(pedido,))
    processo.start()
    processo.join()

    if not (saida / ARQUIVO_FINAL).exists():
        logger.error('Processo do treino %s terminou com código %s', pedido['treinoId'], processo.exitcode)
        enviar = criar_enviador(pedido['callbackUrl'], pedido['callbackToken'])
        enviar(
            status='FALHA',
            log=(
                f'O processo de treino terminou de forma inesperada (código {processo.exitcode}). '
                'Veja os logs do container trainer.'
            ),
        )


def _executar_filho(pedido: dict) -> None:
    enviar = criar_enviador(pedido['callbackUrl'], pedido['callbackToken'])
    saida = Path(pedido['saidaDir'])
    try:
        saida.mkdir(parents=True, exist_ok=True)
        enviar(status='EXECUTANDO', log=f"Treino {pedido['treinoId']} iniciado ({pedido['tipo']}).")
        if pedido['tipo'] == 'TINYML':
            from app.modelos import tinyml

            tinyml.executar_tinyml(pedido, enviar)
        elif pedido['tipo'] == 'TABULAR':
            from app.modelos import tabular  # escrito pelo m05; importado só aqui

            tabular.executar_tabular(pedido, enviar)
        else:
            raise ValueError(f"Tipo de modelo desconhecido: {pedido['tipo']}")
    except Exception:
        erro = traceback.format_exc()
        (saida / ARQUIVO_FINAL).write_text('FALHA', encoding='utf-8')
        enviar(status='FALHA', log='Erro durante o treino:\n' + erro)
