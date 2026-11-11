"""Dataset de conversas (CONVERSAS, .jsonl) para o treino LLM local.

Cada linha é {"messages": [{"role": "system|user|assistant", "content": "..."}]}.
A validação segue a regra do servidor: cada conversa tem ao menos um `user` e um
`assistant`, a última mensagem é `assistant`, e o arquivo tem no mínimo 10 conversas.
Erros citam o número da linha.
"""

import json

PAPEIS = ('system', 'user', 'assistant')
MINIMO_CONVERSAS = 10


def _validar_conversa(numero: int, conversa) -> list[dict]:
    if not isinstance(conversa, dict) or not isinstance(conversa.get('messages'), list):
        raise ValueError(f'Linha {numero}: esperado um objeto com a lista "messages".')
    mensagens = conversa['messages']
    if not mensagens:
        raise ValueError(f'Linha {numero}: conversa sem mensagens.')

    for mensagem in mensagens:
        if not isinstance(mensagem, dict):
            raise ValueError(f'Linha {numero}: mensagem inválida.')
        if mensagem.get('role') not in PAPEIS:
            raise ValueError(f'Linha {numero}: papel inválido {mensagem.get("role")!r}.')
        if not isinstance(mensagem.get('content'), str):
            raise ValueError(f'Linha {numero}: "content" precisa ser texto.')

    papeis = {mensagem['role'] for mensagem in mensagens}
    if 'user' not in papeis or 'assistant' not in papeis:
        raise ValueError(f'Linha {numero}: a conversa precisa de mensagens user e assistant.')
    if mensagens[-1]['role'] != 'assistant':
        raise ValueError(f'Linha {numero}: a última mensagem precisa ser do assistant.')
    return mensagens


def carregar_conversas(caminho) -> list[dict]:
    """Lê e valida o .jsonl. Devolve a lista de conversas (cada uma com 'messages')."""
    conversas: list[dict] = []
    with open(caminho, encoding='utf-8') as arquivo:
        for numero, linha in enumerate(arquivo, start=1):
            if not linha.strip():
                continue
            try:
                objeto = json.loads(linha)
            except json.JSONDecodeError as erro:
                raise ValueError(f'Linha {numero}: JSON inválido ({erro.msg}).') from erro
            mensagens = _validar_conversa(numero, objeto)
            conversas.append({'messages': mensagens})

    if len(conversas) < MINIMO_CONVERSAS:
        raise ValueError(
            f'O dataset tem {len(conversas)} conversas; o mínimo é {MINIMO_CONVERSAS}.'
        )
    return conversas


def formatar(conversas: list[dict], tokenizer, prompt_sistema: str) -> list[str]:
    """Converte cada conversa em texto usando o chat template do modelo base.

    Se a conversa não tiver mensagem `system` e `prompt_sistema` não estiver vazio,
    insere a mensagem `system` no início.
    """
    textos: list[str] = []
    for conversa in conversas:
        mensagens = [dict(m) for m in conversa['messages']]
        if prompt_sistema and not any(m['role'] == 'system' for m in mensagens):
            mensagens.insert(0, {'role': 'system', 'content': prompt_sistema})
        textos.append(tokenizer.apply_chat_template(mensagens, tokenize=False))
    return textos
