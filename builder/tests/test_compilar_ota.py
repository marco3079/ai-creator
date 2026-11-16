import os
import sys
import tempfile

import pytest

# Permite importar o pacote `app` ao rodar `python -m pytest` a partir da pasta builder/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.compilar import NOME_ARTEFATO_OTA, _copiar_artefato_ota  # noqa: E402


def test_copia_firmware_da_aplicacao_para_ota():
    with tempfile.TemporaryDirectory() as build_dir, tempfile.TemporaryDirectory() as saida_dir:
        with open(os.path.join(build_dir, "firmware.bin"), "wb") as f:
            f.write(b"APP-BINARIO")
        with open(os.path.join(build_dir, "firmware-merged-falso.bin"), "wb") as f:
            f.write(b"MESCLADO")

        destino = _copiar_artefato_ota(build_dir, saida_dir)

        assert destino == os.path.join(saida_dir, NOME_ARTEFATO_OTA)
        assert NOME_ARTEFATO_OTA == "firmware-ota.bin"
        with open(destino, "rb") as f:
            assert f.read() == b"APP-BINARIO"


def test_sem_firmware_levanta_erro_e_nao_cria_saida():
    with tempfile.TemporaryDirectory() as build_dir, tempfile.TemporaryDirectory() as saida_dir:
        with pytest.raises(FileNotFoundError):
            _copiar_artefato_ota(build_dir, saida_dir)
        assert not os.path.exists(os.path.join(saida_dir, NOME_ARTEFATO_OTA))
