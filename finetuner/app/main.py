import threading
from typing import Literal

from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel, Field

from app import treino

app = FastAPI(title='AI Creator - Finetuner')

# Um treino por vez: a GPU é compartilhada. Os demais esperam na fila.
GPU = threading.Semaphore(1)


class ConfigLlmLocal(BaseModel):
    modeloBase: Literal['llama3.2:1b', 'llama3.2:3b']
    loraRank: int = Field(ge=1, le=256)
    loraAlpha: int = Field(ge=1, le=512)
    epocas: int = Field(ge=1, le=50)
    taxaAprendizado: float = Field(gt=0, le=1)
    tamanhoLote: int = Field(ge=1, le=64)
    comprimentoMax: int = Field(ge=64, le=8192)
    promptSistema: str = ''


class PedidoTreino(BaseModel):
    treinoId: int
    dataset: str
    saidaDir: str
    config: ConfigLlmLocal
    nomeOllama: str
    ollamaUrl: str = 'http://ollama:11434'
    callbackUrl: str
    callbackToken: str


def _gpu() -> tuple[bool, str]:
    try:
        import torch
    except ImportError:
        return False, 'cpu'
    disponivel = torch.cuda.is_available()
    return disponivel, 'cuda' if disponivel else 'cpu'


@app.get('/saude')
def saude() -> dict:
    gpu, dispositivo = _gpu()
    return {'ok': True, 'gpu': gpu, 'dispositivo': dispositivo}


def _executar_na_fila(pedido: PedidoTreino) -> None:
    if not GPU.acquire(blocking=False):
        treino._callback(pedido, {'log': 'Aguardando a GPU ficar livre...\n'})
        GPU.acquire()
    try:
        treino.executar(pedido)
    finally:
        GPU.release()


@app.post('/treinos', status_code=202)
def criar_treino(pedido: PedidoTreino, tarefas: BackgroundTasks) -> dict:
    tarefas.add_task(_executar_na_fila, pedido)
    return {'aceito': True}
