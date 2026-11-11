"""API HTTP do builder (porta 8002)."""

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

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


@app.post("/builds", status_code=202)
def criar_build(corpo: NovoBuild, tarefas: BackgroundTasks) -> dict:
    if corpo.placa not in PLACAS:
        raise HTTPException(status_code=400, detail=f"Placa desconhecida: {corpo.placa}")
    tarefas.add_task(
        executar_build,
        corpo.buildId,
        corpo.projetoDir,
        corpo.placa,
        corpo.saidaDir,
        corpo.callbackUrl,
        corpo.callbackToken,
    )
    return {"ok": True, "buildId": corpo.buildId}


@app.post("/gravar")
def rota_gravar(corpo: Gravacao) -> dict:
    if corpo.placa not in PLACAS:
        raise HTTPException(status_code=400, detail=f"Placa desconhecida: {corpo.placa}")
    return gravar(corpo.artefato, corpo.placa, corpo.porta, corpo.offset)
