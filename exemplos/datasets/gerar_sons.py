"""Gera sons.zip: áudios sintéticos de 1 s para o exemplo de palavra-chave (KWS, TinyML tarefa AUDIO).

Classes (pastas na raiz do zip): grave (~300 Hz), agudo (~1500 Hz) e silencio (ruído baixo).
20 arquivos .wav por classe, PCM de 16 bits, mono, 16 kHz, 1 s cada, com variação de
frequência, volume e início do tom. O zip fica abaixo de 2 MB.

Uso: python -I exemplos/datasets/gerar_sons.py
"""

import io
import wave
import zipfile
from pathlib import Path

import numpy as np

CLASSES = ('grave', 'agudo', 'silencio')
ARQUIVOS_POR_CLASSE = 20
TAXA_HZ = 16000
DURACAO_S = 1.0
SEMENTE = 42
SAIDA = Path(__file__).resolve().parent / 'sons.zip'


def wav_pcm16(amostras: np.ndarray, taxa: int = TAXA_HZ) -> bytes:
    """Codifica amostras float em [-1, 1] como WAV mono PCM de 16 bits."""
    dados = np.clip(np.round(amostras * 32767.0), -32768, 32767).astype('<i2')
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as arquivo:
        arquivo.setnchannels(1)
        arquivo.setsampwidth(2)
        arquivo.setframerate(taxa)
        arquivo.writeframes(dados.tobytes())
    return buffer.getvalue()


def _tom(rng: np.random.Generator, frequencia: float) -> np.ndarray:
    """Tom de 1 s com início, duração, volume e leve vibrato aleatórios."""
    n = int(TAXA_HZ * DURACAO_S)
    t = np.arange(n) / TAXA_HZ
    inicio = rng.uniform(0.05, 0.35)
    duracao = rng.uniform(0.35, 0.6)
    volume = rng.uniform(0.3, 0.7)
    vibrato = 1.0 + 0.01 * np.sin(2 * np.pi * rng.uniform(4, 8) * t)
    fase = 2 * np.pi * np.cumsum(frequencia * vibrato) / TAXA_HZ
    onda = np.sin(fase)
    # envelope: sobe e desce suavemente dentro da janela do tom
    envelope = np.zeros(n)
    i0, i1 = int(inicio * TAXA_HZ), int((inicio + duracao) * TAXA_HZ)
    i1 = min(i1, n)
    janela = np.hanning(max(i1 - i0, 2))[: i1 - i0]
    envelope[i0:i1] = janela
    return volume * envelope * onda + rng.normal(0.0, 0.005, n)


def gerar_amostra(classe: str, rng: np.random.Generator) -> np.ndarray:
    if classe == 'grave':
        return _tom(rng, rng.uniform(260, 340))
    if classe == 'agudo':
        return _tom(rng, rng.uniform(1300, 1700))
    # silencio: só ruído de fundo baixo, sem tom
    n = int(TAXA_HZ * DURACAO_S)
    return rng.normal(0.0, rng.uniform(0.002, 0.02), n)


def gerar(saida: Path = SAIDA) -> dict[str, int]:
    rng = np.random.default_rng(SEMENTE)
    contagem: dict[str, int] = {}
    with zipfile.ZipFile(saida, 'w', compression=zipfile.ZIP_DEFLATED) as zip_:
        for classe in CLASSES:
            for i in range(1, ARQUIVOS_POR_CLASSE + 1):
                amostras = gerar_amostra(classe, rng)
                zip_.writestr(f'{classe}/{classe}_{i:02d}.wav', wav_pcm16(amostras))
            contagem[classe] = ARQUIVOS_POR_CLASSE
    return contagem


if __name__ == '__main__':
    contagem = gerar()
    tamanho_kb = SAIDA.stat().st_size / 1024
    print(f'{SAIDA.name}: {contagem} ({tamanho_kb:.0f} KB)')
