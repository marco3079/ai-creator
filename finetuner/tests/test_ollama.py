import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import pytest

from app import ollama, treino


class OllamaFalso(BaseHTTPRequestHandler):
    """Imita as rotas usadas: blobs (HEAD/POST), pull e create."""

    blobs: dict = {}
    eventos: list = []

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        digest = self.path.rsplit('/', 1)[-1]
        self.eventos.append(('HEAD', self.path))
        self.send_response(200 if digest in self.blobs else 404)
        self.end_headers()

    def _corpo(self) -> bytes:
        tamanho = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(tamanho)

    def _responder(self, dados: dict):
        corpo = json.dumps(dados).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        corpo = self._corpo()
        self.eventos.append(('POST', self.path))
        if self.path.startswith('/api/blobs/'):
            digest = self.path.rsplit('/', 1)[-1]
            self.blobs[digest] = corpo
            self.send_response(201)
            self.end_headers()
        elif self.path == '/api/pull':
            self.eventos.append(('PULL', json.loads(corpo)))
            self._responder({'status': 'success'})
        elif self.path == '/api/create':
            self.eventos.append(('CREATE', json.loads(corpo)))
            self._responder({'status': 'success'})
        else:
            self.send_response(404)
            self.end_headers()


@pytest.fixture
def servidor():
    OllamaFalso.blobs = {}
    OllamaFalso.eventos = []
    srv = HTTPServer(('127.0.0.1', 0), OllamaFalso)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()
    srv.server_close()


def test_sha256_arquivo_formato_ollama(tmp_path):
    arquivo = tmp_path / 'a.bin'
    arquivo.write_bytes(b'conteudo')
    esperado = 'sha256:' + hashlib.sha256(b'conteudo').hexdigest()
    assert ollama.sha256_arquivo(str(arquivo)) == esperado


def test_enviar_blob_faz_head_e_post_quando_falta(servidor, tmp_path):
    arquivo = tmp_path / 'adapter.safetensors'
    arquivo.write_bytes(b'pesos')
    digest = ollama.enviar_blob(servidor, str(arquivo))
    assert digest == ollama.sha256_arquivo(str(arquivo))
    assert [e[0] for e in OllamaFalso.eventos] == ['HEAD', 'POST']
    assert OllamaFalso.blobs[digest] == b'pesos'


def test_enviar_blob_pula_upload_quando_ja_existe(servidor, tmp_path):
    arquivo = tmp_path / 'adapter.safetensors'
    arquivo.write_bytes(b'pesos')
    ollama.enviar_blob(servidor, str(arquivo))
    OllamaFalso.eventos.clear()
    ollama.enviar_blob(servidor, str(arquivo))
    assert [e[0] for e in OllamaFalso.eventos] == ['HEAD']


def test_registrar_adaptador_fluxo_blobs_depois_create(servidor, tmp_path):
    safetensors = tmp_path / 'adapter_model.safetensors'
    config = tmp_path / 'adapter_config.json'
    safetensors.write_bytes(b'pesos')
    config.write_text('{"r": 16}', encoding='utf-8')

    ollama.garantir_base(servidor, 'llama3.2:1b')
    ollama.registrar_adaptador(
        servidor,
        'aic-meu-modelo-v1',
        'llama3.2:1b',
        {'adapter_model.safetensors': str(safetensors), 'adapter_config.json': str(config)},
        'Seja breve.',
    )

    uploads_blob = [e for e in OllamaFalso.eventos if e[0] == 'POST' and e[1].startswith('/api/blobs/')]
    assert len(uploads_blob) == 2
    assert OllamaFalso.eventos[-1][0] == 'CREATE'
    assert ('PULL', {'model': 'llama3.2:1b', 'stream': False}) in OllamaFalso.eventos
    assert OllamaFalso.eventos.index(('PULL', {'model': 'llama3.2:1b', 'stream': False})) < \
        OllamaFalso.eventos.index(next(e for e in OllamaFalso.eventos if e[0] == 'CREATE'))

    criacao = next(e[1] for e in OllamaFalso.eventos if e[0] == 'CREATE')
    assert criacao['model'] == 'aic-meu-modelo-v1'
    assert criacao['from'] == 'llama3.2:1b'
    assert criacao['system'] == 'Seja breve.'
    assert criacao['stream'] is False
    assert criacao['adapters'] == {
        'adapter_model.safetensors': ollama.sha256_arquivo(str(safetensors)),
        'adapter_config.json': ollama.sha256_arquivo(str(config)),
    }


class OllamaTextoECallback(BaseHTTPRequestHandler):
    """Ollama que responde texto puro em /api/create, e um endpoint de callback."""

    chamadas: list = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        tamanho = int(self.headers.get('Content-Length', 0))
        corpo = self.rfile.read(tamanho)
        self.chamadas.append((self.path, corpo))
        if self.path == '/api/create':
            resposta = b'erro inesperado sem JSON'
            tipo = 'text/plain'
        elif self.path == '/api/pull':
            resposta = b'{"status": "success"}'
            tipo = 'application/json'
        else:
            resposta = b''
            tipo = 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(resposta)))
        self.end_headers()
        self.wfile.write(resposta)


def test_resposta_texto_no_create_vira_aviso_e_sucesso_sem_modelo(tmp_path, monkeypatch):
    OllamaTextoECallback.chamadas = []
    srv = HTTPServer(('127.0.0.1', 0), OllamaTextoECallback)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    try:
        arquivos = {}
        for nome in ('adapter_model.safetensors', 'adapter_config.json'):
            caminho = tmp_path / nome
            caminho.write_bytes(b'x')
            arquivos[nome] = caminho

        pedido = SimpleNamespace(
            treinoId=7,
            nomeOllama='aic-teste-v1',
            ollamaUrl=base,
            callbackUrl=f'{base}/callback',
            callbackToken='token-de-teste',
            config=SimpleNamespace(modeloBase='llama3.2:1b', promptSistema=''),
        )

        def treinar_simulado(pedido_, registro):
            modelo = treino._registrar_no_ollama(pedido_, registro, arquivos)
            return {'modeloResultante': modelo, 'metricas': {}, 'artefatos': []}

        monkeypatch.setattr(treino, '_treinar', treinar_simulado)
        treino._executar_local(pedido)
    finally:
        srv.shutdown()
        srv.server_close()

    callbacks = [json.loads(c) for caminho, c in OllamaTextoECallback.chamadas if caminho == '/callback']
    assert callbacks[-1]['status'] == 'SUCESSO'
    assert callbacks[-1]['modeloResultante'] is None
    assert 'AVISO' in callbacks[-1]['log']
