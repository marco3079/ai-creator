from typing import Literal

from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel, Field

from app import treino
from app.modelos import executar as executar_modelo

app = FastAPI(title='AI Creator - Trainer')


class Entrada(BaseModel):
    tipo: Literal['SERIE_TEMPORAL', 'AUDIO', 'TABELA']
    canais: int
    janela: int
    frequenciaHz: float


class ConfigTinyml(BaseModel):
    tarefa: Literal['CLASSIFICACAO']
    entrada: Entrada
    classes: list[str] = []
    arquitetura: Literal['DENSA', 'CNN1D', 'DS_CNN']
    camadas: int = Field(ge=1, le=6)
    neuronios: int = Field(ge=4, le=256)
    epocas: int = Field(ge=1, le=500)
    taxaAprendizado: float
    quantizacao: Literal['INT8', 'FLOAT32']
    placaAlvo: Literal[
        'ESP32', 'ESP32S3', 'ARDUINO_NANO33BLE', 'ARDUINO_UNO', 'STM32_NUCLEO_F401RE', 'RP2040_PICO'
    ]
    limiteRamKb: float
    limiteFlashKb: float
    datasetId: int | None = None
    ultimoTreinoId: int | None = None


class PedidoTreino(BaseModel):
    treinoId: int
    csv: str
    saidaDir: str
    config: ConfigTinyml
    callbackUrl: str
    callbackToken: str


class PedidoModelo(BaseModel):
    """Contrato de POST /modelos/treinos (CONTRATOS-MODELOS.md §5)."""

    treinoId: int
    tipo: Literal['TINYML', 'TABULAR']
    tarefa: Literal['CLASSIFICACAO', 'REGRESSAO', 'IMAGEM']
    dataset: dict
    saidaDir: str
    config: dict
    callbackUrl: str
    callbackToken: str


@app.get('/saude')
def saude() -> dict:
    return {'ok': True}


@app.post('/treinos', status_code=202)
def criar_treino(pedido: PedidoTreino, tarefas: BackgroundTasks) -> dict:
    tarefas.add_task(treino.executar, pedido)
    return {'aceito': True}


@app.post('/modelos/treinos', status_code=202)
def criar_treino_modelo(pedido: PedidoModelo, tarefas: BackgroundTasks) -> dict:
    tarefas.add_task(executar_modelo.executar, pedido.model_dump())
    return {'aceito': True}
