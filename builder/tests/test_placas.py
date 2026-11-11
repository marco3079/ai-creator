import os
import sys

# Permite importar o pacote `app` ao rodar `python -m pytest` a partir da pasta builder/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.placas import PLACAS, ini_para  # noqa: E402


def test_ini_esp32_tem_env_e_placa():
    ini = ini_para("ESP32")
    assert "[env:principal]" in ini
    assert "board = esp32dev" in ini
    assert "board_build.partitions = huge_app.csv" in ini


def test_ini_esp32s3_usa_partitions():
    ini = ini_para("ESP32S3")
    assert "board = esp32-s3-devkitc-1" in ini
    assert "board_build.partitions = huge_app.csv" in ini


def test_ini_placa_nao_esp_sem_partitions():
    ini = ini_para("ARDUINO_UNO")
    assert "[env:principal]" in ini
    assert "board = uno" in ini
    assert "board_build.partitions" not in ini


def test_todas_as_seis_placas_existem():
    esperadas = {
        "ESP32",
        "ESP32S3",
        "ARDUINO_NANO33BLE",
        "ARDUINO_UNO",
        "STM32_NUCLEO_F401RE",
        "RP2040_PICO",
    }
    assert set(PLACAS) == esperadas
    for nome in esperadas:
        assert "[env:principal]" in ini_para(nome)
