"""Compilação de projetos PlatformIO e envio de callbacks ao servidor."""

import os
import shutil
import subprocess
import sys

import httpx

from app.placas import PLACAS

DATA_DIR = os.environ.get("DATA_DIR", "/data")
LIMITE_LOG = 200 * 1024  # bytes
TIMEOUT_PIO = 900  # segundos

# Offset do bootloader e do app no firmware mesclado (ESP32 e ESP32S3).
OFFSETS_ESP = {
    "esp32": {"bootloader": "0x1000", "partitions": "0x8000", "app": "0x10000"},
    "esp32s3": {"bootloader": "0x0", "partitions": "0x8000", "app": "0x10000"},
}


def _cortar_log(texto: str) -> str:
    dados = texto.encode("utf-8", errors="replace")
    if len(dados) <= LIMITE_LOG:
        return texto
    return dados[-LIMITE_LOG:].decode("utf-8", errors="ignore")


def _callback(url: str, token: str, corpo: dict) -> None:
    """Envia o status ao servidor. Nunca lança: falha de rede só é ignorada aqui."""
    try:
        httpx.post(url, json=corpo, headers={"X-Interno-Token": token}, timeout=30)
    except Exception:
        pass


def _mesclar_esp(chip: str, build_dir: str, saida: str) -> tuple[bool, str]:
    """Gera firmware-merged.bin com bootloader, partitions e app nos offsets do chip."""
    off = OFFSETS_ESP[chip]
    cmd = [
        sys.executable, "-m", "esptool",
        "--chip", chip,
        "merge_bin",
        "-o", saida,
        "--flash_mode", "dio",
        "--flash_size", "4MB",
        off["bootloader"], os.path.join(build_dir, "bootloader.bin"),
        off["partitions"], os.path.join(build_dir, "partitions.bin"),
        off["app"], os.path.join(build_dir, "firmware.bin"),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    log = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, log


def executar_build(
    build_id: int,
    projeto_dir: str,
    placa: str,
    saida_dir: str,
    callback_url: str,
    callback_token: str,
) -> None:
    """Roda em segundo plano: compila o projeto e chama o callback com o resultado."""
    _callback(callback_url, callback_token, {"status": "EXECUTANDO"})

    info = PLACAS[placa]
    log = ""
    try:
        proc = subprocess.run(
            ["pio", "run", "-d", projeto_dir],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT_PIO,
        )
        log = (proc.stdout or "") + (proc.stderr or "")
        if proc.returncode != 0:
            _callback(callback_url, callback_token, {"status": "FALHA", "log": _cortar_log(log)})
            return

        build_dir = os.path.join(projeto_dir, ".pio", "build", "principal")
        os.makedirs(saida_dir, exist_ok=True)
        nome_artefato = info["artefato"]
        saida = os.path.join(saida_dir, nome_artefato)

        if info["chip"] in OFFSETS_ESP:
            ok, log_merge = _mesclar_esp(info["chip"], build_dir, saida)
            log += "\n" + log_merge
            if not ok:
                _callback(callback_url, callback_token, {"status": "FALHA", "log": _cortar_log(log)})
                return
        else:
            origem = os.path.join(build_dir, nome_artefato)
            if not os.path.exists(origem):
                log += f"\nArtefato não encontrado: {origem}"
                _callback(callback_url, callback_token, {"status": "FALHA", "log": _cortar_log(log)})
                return
            shutil.copyfile(origem, saida)

        relativo = os.path.relpath(saida, DATA_DIR).replace("\\", "/")
        _callback(
            callback_url,
            callback_token,
            {
                "status": "SUCESSO",
                "log": _cortar_log(log),
                "artefato": relativo,
                "offset": info["offset"],
                "tamanhoBytes": os.path.getsize(saida),
            },
        )
    except subprocess.TimeoutExpired:
        log += f"\nTempo limite de {TIMEOUT_PIO} s excedido na compilação."
        _callback(callback_url, callback_token, {"status": "FALHA", "log": _cortar_log(log)})
    except Exception as erro:  # erro inesperado também vira FALHA
        log += f"\nErro interno no builder: {erro}"
        _callback(callback_url, callback_token, {"status": "FALHA", "log": _cortar_log(log)})
