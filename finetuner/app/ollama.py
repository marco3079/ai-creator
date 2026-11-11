"""Cliente mínimo da API HTTP do Ollama para registrar um adaptador LoRA.

Fluxo: garante o modelo base (`/api/pull`), envia cada arquivo do adaptador como
blob (`HEAD` e, se faltar, `POST /api/blobs/<digest>`) e cria o modelo com
`POST /api/create` apontando para os blobs.
"""

import hashlib
from pathlib import Path

import httpx

TIMEOUT_CURTO = 30
TIMEOUT_UPLOAD = 600
TIMEOUT_PULL = 1800


def sha256_arquivo(caminho) -> str:
    """Devolve o digest no formato do Ollama: 'sha256:<hex>'."""
    hash_ = hashlib.sha256()
    with open(caminho, 'rb') as arquivo:
        for bloco in iter(lambda: arquivo.read(1 << 20), b''):
            hash_.update(bloco)
    return f'sha256:{hash_.hexdigest()}'


def _checar(resposta: httpx.Response) -> dict:
    resposta.raise_for_status()
    corpo = resposta.json() if resposta.content else {}
    if isinstance(corpo, dict) and corpo.get('error'):
        raise RuntimeError(f'Ollama recusou a operação: {corpo["error"]}')
    return corpo


def enviar_blob(url: str, caminho) -> str:
    """Garante que o arquivo esteja no Ollama como blob. Devolve o digest."""
    base = url.rstrip('/')
    digest = sha256_arquivo(caminho)
    endereco = f'{base}/api/blobs/{digest}'

    existe = httpx.head(endereco, timeout=TIMEOUT_CURTO)
    if existe.status_code == 404:
        envio = httpx.post(endereco, content=Path(caminho).read_bytes(), timeout=TIMEOUT_UPLOAD)
        envio.raise_for_status()
    elif existe.status_code != 200:
        existe.raise_for_status()
    return digest


def garantir_base(url: str, modelo: str) -> None:
    """Baixa o modelo base no Ollama, se ainda não estiver lá."""
    resposta = httpx.post(
        f'{url.rstrip("/")}/api/pull',
        json={'model': modelo, 'stream': False},
        timeout=TIMEOUT_PULL,
    )
    _checar(resposta)


def registrar_adaptador(
    url: str,
    nome: str,
    base: str,
    arquivos: dict[str, str],
    sistema: str | None,
) -> None:
    """Cria o modelo `nome` no Ollama = `base` + adaptador LoRA.

    `arquivos` mapeia o nome do arquivo (ex.: 'adapter_model.safetensors') para
    o caminho local dele.
    """
    base_url = url.rstrip('/')
    adaptadores = {nome_arquivo: enviar_blob(base_url, caminho) for nome_arquivo, caminho in arquivos.items()}

    corpo: dict = {'model': nome, 'from': base, 'adapters': adaptadores, 'stream': False}
    if sistema:
        corpo['system'] = sistema
    resposta = httpx.post(f'{base_url}/api/create', json=corpo, timeout=TIMEOUT_UPLOAD)
    _checar(resposta)
