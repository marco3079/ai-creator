"""Tabela de placas suportadas e geração do platformio.ini."""

PLACAS: dict[str, dict] = {
    "ESP32": {
        "platform": "espressif32",
        "board": "esp32dev",
        "framework": "arduino",
        "artefato": "firmware-merged.bin",
        "offset": "0x0",
        "chip": "esp32",
    },
    "ESP32S3": {
        "platform": "espressif32",
        "board": "esp32-s3-devkitc-1",
        "framework": "arduino",
        "artefato": "firmware-merged.bin",
        "offset": "0x0",
        "chip": "esp32s3",
    },
    "ARDUINO_NANO33BLE": {
        "platform": "nordicnrf52",
        "board": "nano33ble",
        "framework": "arduino",
        "artefato": "firmware.bin",
        "offset": None,
        "chip": None,
    },
    "ARDUINO_UNO": {
        "platform": "atmelavr",
        "board": "uno",
        "framework": "arduino",
        "artefato": "firmware.hex",
        "offset": None,
        "chip": None,
    },
    "STM32_NUCLEO_F401RE": {
        "platform": "ststm32",
        "board": "nucleo_f401re",
        "framework": "arduino",
        "artefato": "firmware.bin",
        "offset": "0x08000000",
        "chip": None,
    },
    "RP2040_PICO": {
        "platform": "raspberrypi",
        "board": "pico",
        "framework": "arduino",
        "artefato": "firmware.uf2",
        "offset": None,
        "chip": None,
    },
}


def ini_para(placa: str) -> str:
    """Gera o platformio.ini com o ambiente [env:principal] para a placa."""
    if placa not in PLACAS:
        raise ValueError(f"Placa desconhecida: {placa}")
    info = PLACAS[placa]
    linhas = [
        "[env:principal]",
        f"platform = {info['platform']}",
        f"board = {info['board']}",
        f"framework = {info['framework']}",
        "monitor_speed = 115200",
    ]
    if info["chip"] in ("esp32", "esp32s3"):
        linhas.append("board_build.partitions = huge_app.csv")
    return "\n".join(linhas) + "\n"
