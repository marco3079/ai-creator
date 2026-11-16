from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field

from app import ativos, treino
from app.modelos import executar as executar_modelo
from app.modelos import prever as prever_modelo

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


class ArtefatosPrever(BaseModel):
    tflite: str | None = None
    joblib: str | None = None
    metricas: str


class EntradaPrever(BaseModel):
    valores: list[float] | None = None
    imagemBase64: str | None = None
    audioBase64: str | None = None


class PedidoPrever(BaseModel):
    """Contrato de POST /modelos/prever (CONTRATOS-MELHORIAS.md §3). Caminhos dos artefatos são absolutos."""

    tipo: Literal['TINYML', 'TABULAR']
    tarefa: Literal['CLASSIFICACAO', 'REGRESSAO', 'IMAGEM', 'AUDIO']
    artefatos: ArtefatosPrever
    config: dict
    entrada: EntradaPrever


@app.get('/saude')
def saude() -> dict:
    return {'ok': True}


@app.get('/trabalhos')
def trabalhos() -> dict:
    return ativos.listar()


def _treino_em_segundo_plano(pedido: PedidoTreino) -> None:
    try:
        treino.executar(pedido)
    finally:
        ativos.desmarcar('treinos', pedido.treinoId)


def _treino_modelo_em_segundo_plano(pedido: dict) -> None:
    try:
        executar_modelo.executar(pedido)
    finally:
        ativos.desmarcar('treinosModelo', pedido['treinoId'])


@app.post('/treinos', status_code=202)
def criar_treino(pedido: PedidoTreino, tarefas: BackgroundTasks) -> dict:
    ativos.marcar('treinos', pedido.treinoId)
    tarefas.add_task(_treino_em_segundo_plano, pedido)
    return {'aceito': True}


@app.post('/modelos/treinos', status_code=202)
def criar_treino_modelo(pedido: PedidoModelo, tarefas: BackgroundTasks) -> dict:
    ativos.marcar('treinosModelo', pedido.treinoId)
    tarefas.add_task(_treino_modelo_em_segundo_plano, pedido.model_dump())
    return {'aceito': True}


@app.post('/modelos/prever')
def prever(pedido: PedidoPrever) -> dict:
    try:
        return prever_modelo.prever(pedido.model_dump())
    except prever_modelo.EntradaInvalida as erro:
        raise HTTPException(status_code=400, detail=str(erro)) from erro
    except prever_modelo.Indisponivel as erro:
        raise HTTPException(status_code=501, detail=str(erro)) from erro
