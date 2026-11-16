"""API HTTP do builder (porta 8002)."""

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from app import ativos
from app.compilar import executar_build
from app.gravar import gravar
from app.placas import PLACAS

app = FastAPI(title="AI Creator Builder")


class NovoBuild(BaseModel):
    buildId: int
    projetoDir: str
    placa: str
    saidaDir: str
    callbackUrl: str
    callbackToken: str


class Gravacao(BaseModel):
    artefato: str
    placa: str
    porta: str
    offset: str | None = None


@app.get("/saude")
def saude() -> dict:
    return {"ok": True}


@app.get("/trabalhos")
def trabalhos() -> dict:
    return ativos.listar()


def _build_em_segundo_plano(corpo: NovoBuild) -> None:
    try:
        executar_build(
            corpo.buildId,
            corpo.projetoDir,
            corpo.placa,
            corpo.saidaDir,
            corpo.callbackUrl,
            corpo.callbackToken,
        )
    finally:
        ativos.desmarcar("builds", corpo.buildId)


@app.post("/builds", status_code=202)
def criar_build(corpo: NovoBuild, tarefas: BackgroundTasks) -> dict:
    if corpo.placa not in PLACAS:
        raise HTTPException(status_code=400, detail=f"Placa desconhecida: {corpo.placa}")
    ativos.marcar("builds", corpo.buildId)
    tarefas.add_task(_build_em_segundo_plano, corpo)
    return {"ok": True, "buildId": corpo.buildId}


@app.post("/gravar")
def rota_gravar(corpo: Gravacao) -> dict:
    if corpo.placa not in PLACAS:
        raise HTTPException(status_code=400, detail=f"Placa desconhecida: {corpo.placa}")
    return gravar(corpo.artefato, corpo.placa, corpo.porta, corpo.offset)
