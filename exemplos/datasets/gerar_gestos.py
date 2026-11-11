"""Gera gestos.csv: amostras sintéticas de acelerômetro (3 canais x 50 pontos).

Classes: parado, acenar (senoide no eixo x), circulo (seno/cosseno em x e y).
Formato: cabeçalho rotulo,f0..f149; atributos em ordem tempo-major
(ax0,ay0,az0,ax1,...), como o contrato de datasets.

Uso: python -I exemplos/datasets/gerar_gestos.py
"""

from pathlib import Path

import numpy as np

AMOSTRAS_POR_CLASSE = 100
CANAIS = 3
PONTOS = 50
FREQUENCIA_HZ = 50
GRAVIDADE = 9.8
RUIDO = 0.2
SEMENTE = 42
SAIDA = Path(__file__).resolve().parent / 'gestos.csv'


def _gerar_classe(rotulo: str, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(PONTOS) / FREQUENCIA_HZ
    amostras = np.zeros((AMOSTRAS_POR_CLASSE, PONTOS, CANAIS))
    for i in range(AMOSTRAS_POR_CLASSE):
        amplitude = rng.uniform(2.0, 4.0)
        frequencia = rng.uniform(0.8, 1.5) if rotulo == 'circulo' else rng.uniform(1.5, 2.5)
        fase = rng.uniform(0, 2 * np.pi)
        base = np.zeros((PONTOS, CANAIS))
        base[:, 2] = GRAVIDADE
        if rotulo == 'acenar':
            base[:, 0] += amplitude * np.sin(2 * np.pi * frequencia * t + fase)
        elif rotulo == 'circulo':
            base[:, 0] += amplitude * np.cos(2 * np.pi * frequencia * t + fase)
            base[:, 1] += amplitude * np.sin(2 * np.pi * frequencia * t + fase)
        amostras[i] = base + rng.normal(0, RUIDO, size=base.shape)
    return amostras


def main() -> None:
    rng = np.random.default_rng(SEMENTE)
    linhas = []
    for rotulo in ('parado', 'acenar', 'circulo'):
        if rotulo == 'parado':
            dados = np.zeros((AMOSTRAS_POR_CLASSE, PONTOS, CANAIS))
            dados[:, :, 2] = GRAVIDADE
            dados += rng.normal(0, RUIDO, size=dados.shape)
        else:
            dados = _gerar_classe(rotulo, rng)
        for amostra in dados:
            linhas.append(rotulo + ',' + ','.join(f'{v:.4f}' for v in amostra.reshape(-1)))

    total_atributos = PONTOS * CANAIS
    cabecalho = 'rotulo,' + ','.join(f'f{i}' for i in range(total_atributos))
    SAIDA.write_text('\n'.join([cabecalho, *linhas]) + '\n', encoding='utf-8')
    print(f'{len(linhas)} amostras gravadas em {SAIDA}')


if __name__ == '__main__':
    main()
