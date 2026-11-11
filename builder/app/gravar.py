"""Gravação de firmware ESP32 pela porta USB mapeada no container."""

import os
import subprocess
import sys

from app.placas import PLACAS

ESP_CHIPS = {"ESP32": "esp32", "ESP32S3": "esp32s3"}


def gravar(artefato: str, placa: str, porta: str, offset: str | None = None) -> dict:
    """Grava o artefato via esptool. Retorna {ok, log}; não lança exceção por erro de uso."""
    if placa not in ESP_CHIPS:
        return {"ok": False, "log": "Gravação no servidor só para ESP32; use o VS Code ou o download."}

    if not os.path.exists(porta):
        return {
            "ok": False,
            "log": f"Porta {porta} não encontrada no container. No Linux, mapeie o dispositivo em docker-compose (devices).",
        }

    chip = ESP_CHIPS[placa]
    endereco = offset or PLACAS[placa]["offset"] or "0x0"
    cmd = [
        sys.executable, "-m", "esptool",
        "--chip", chip,
        "--port", porta,
        "--baud", "921600",
        "write_flash", endereco, artefato,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    except subprocess.TimeoutExpired:
        return {"ok": False, "log": "Tempo limite de 300 s excedido na gravação."}

    log = (proc.stdout or "") + (proc.stderr or "")
    return {"ok": proc.returncode == 0, "log": log}
