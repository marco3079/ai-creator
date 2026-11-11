"""Gera formas.zip: imagens sintéticas em escala de cinza para o exemplo de IMAGEM (TinyML).

Classes (pastas na raiz do zip): circulo, quadrado, triangulo.
40 imagens 64x64 por classe, com posição e tamanho aleatórios e ruído.
PNG gerado com Python puro (zlib + struct); numpy só para o desenho.

Uso: python -I exemplos/datasets/gerar_imagens.py
"""

import struct
import zipfile
import zlib
from pathlib import Path

import numpy as np

CLASSES = ('circulo', 'quadrado', 'triangulo')
IMAGENS_POR_CLASSE = 40
TAMANHO = 64
RUIDO = 12.0
SEMENTE = 42
SAIDA = Path(__file__).resolve().parent / 'formas.zip'


def png_cinza(pixels: np.ndarray) -> bytes:
    """Codifica uma matriz uint8 (altura, largura) como PNG em escala de cinza de 8 bits."""

    def bloco(tipo: bytes, dados: bytes) -> bytes:
        crc = zlib.crc32(tipo + dados) & 0xFFFFFFFF
        return struct.pack('>I', len(dados)) + tipo + dados + struct.pack('>I', crc)

    altura, largura = pixels.shape
    linhas = b''.join(b'\x00' + pixels[y].tobytes() for y in range(altura))
    cabecalho = struct.pack('>IIBBBBB', largura, altura, 8, 0, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + bloco(b'IHDR', cabecalho)
        + bloco(b'IDAT', zlib.compress(linhas, 9))
        + bloco(b'IEND', b'')
    )


def _mascara(classe: str, rng: np.random.Generator) -> np.ndarray:
    tamanho = rng.integers(7, 17)
    cx = rng.integers(tamanho + 1, TAMANHO - tamanho - 1)
    cy = rng.integers(tamanho + 1, TAMANHO - tamanho - 1)
    y, x = np.mgrid[0:TAMANHO, 0:TAMANHO]
    if classe == 'circulo':
        return (x - cx) ** 2 + (y - cy) ** 2 <= tamanho ** 2
    if classe == 'quadrado':
        return (np.abs(x - cx) <= tamanho) & (np.abs(y - cy) <= tamanho)
    # triângulo apontando para cima: vértice em (cx, cy - s), base em y = cy + s
    topo = cy - tamanho
    dentro_altura = (y >= topo) & (y <= cy + tamanho)
    meia_largura = (y - topo) / (2.0 * tamanho) * tamanho
    return dentro_altura & (np.abs(x - cx) <= meia_largura)


def gerar_imagem(classe: str, rng: np.random.Generator) -> np.ndarray:
    fundo = rng.uniform(20, 70)
    frente = rng.uniform(170, 250)
    imagem = np.where(_mascara(classe, rng), frente, fundo)
    imagem = imagem + rng.normal(0, RUIDO, size=imagem.shape)
    return np.clip(imagem, 0, 255).astype(np.uint8)


def main() -> None:
    rng = np.random.default_rng(SEMENTE)
    if SAIDA.exists():
        SAIDA.unlink()
    with zipfile.ZipFile(SAIDA, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for classe in CLASSES:
            for i in range(IMAGENS_POR_CLASSE):
                zf.writestr(f'{classe}/{classe}_{i:03d}.png', png_cinza(gerar_imagem(classe, rng)))
    print(f'{SAIDA.name}: {len(CLASSES)} classes x {IMAGENS_POR_CLASSE} imagens {TAMANHO}x{TAMANHO} '
          f'({SAIDA.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
