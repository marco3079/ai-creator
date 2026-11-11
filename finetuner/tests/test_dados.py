import json

import pytest

from app import dados


class TokenizerFalso:
    def apply_chat_template(self, mensagens, tokenize=False):
        assert tokenize is False
        return '|'.join(f'{m["role"]}:{m["content"]}' for m in mensagens)


def conversa(role_final='assistant', com_system=False):
    msgs = []
    if com_system:
        msgs.append({'role': 'system', 'content': 'sistema original'})
    msgs.append({'role': 'user', 'content': 'oi'})
    msgs.append({'role': 'assistant', 'content': 'olá'})
    if role_final != 'assistant':
        msgs.append({'role': role_final, 'content': 'fim'})
    return {'messages': msgs}


def escrever(caminho, linhas):
    caminho.write_text('\n'.join(json.dumps(linha) for linha in linhas), encoding='utf-8')
    return str(caminho)


def test_carrega_dataset_valido(tmp_path):
    arquivo = escrever(tmp_path / 'ok.jsonl', [conversa() for _ in range(10)])
    conversas = dados.carregar_conversas(arquivo)
    assert len(conversas) == 10
    assert conversas[0]['messages'][0]['role'] == 'user'


def test_recusa_menos_de_dez_conversas(tmp_path):
    arquivo = escrever(tmp_path / 'poucas.jsonl', [conversa() for _ in range(9)])
    with pytest.raises(ValueError, match='mínimo é 10'):
        dados.carregar_conversas(arquivo)


def test_recusa_ultima_mensagem_que_nao_e_assistant(tmp_path):
    linhas = [conversa() for _ in range(9)] + [conversa(role_final='user')]
    arquivo = escrever(tmp_path / 'errado.jsonl', linhas)
    with pytest.raises(ValueError, match='Linha 10'):
        dados.carregar_conversas(arquivo)


def test_recusa_json_invalido_com_numero_da_linha(tmp_path):
    arquivo = tmp_path / 'quebrado.jsonl'
    arquivo.write_text(json.dumps(conversa()) + '\n{nao é json\n', encoding='utf-8')
    with pytest.raises(ValueError, match='Linha 2'):
        dados.carregar_conversas(str(arquivo))


def test_recusa_papel_invalido(tmp_path):
    ruim = {'messages': [{'role': 'bot', 'content': 'x'}, {'role': 'assistant', 'content': 'y'}]}
    linhas = [conversa() for _ in range(9)] + [ruim]
    arquivo = escrever(tmp_path / 'papel.jsonl', linhas)
    with pytest.raises(ValueError, match='papel inválido'):
        dados.carregar_conversas(arquivo)


def test_formatar_insere_system_quando_falta():
    textos = dados.formatar([conversa()], TokenizerFalso(), 'Seja breve.')
    assert textos == ['system:Seja breve.|user:oi|assistant:olá']


def test_formatar_mantem_system_existente():
    textos = dados.formatar([conversa(com_system=True)], TokenizerFalso(), 'Outro prompt')
    assert textos == ['system:sistema original|user:oi|assistant:olá']


def test_formatar_sem_prompt_nao_insere_system():
    textos = dados.formatar([conversa()], TokenizerFalso(), '')
    assert textos == ['user:oi|assistant:olá']
