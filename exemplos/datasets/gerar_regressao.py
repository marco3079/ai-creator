"""Gera temperatura.csv: exemplo de REGRESSAO (TinyML).

Cada linha: rotulo, f0..f5 = 6 leituras horárias consecutivas de temperatura (°C);
rotulo = temperatura prevista para a hora seguinte à última leitura (com ruído).
400 amostras. Cabeçalho: rotulo,f0,...,f5.

Uso: python -I exemplos/datasets/gerar_regressao.py
"""

from pathlib import Path

import numpy as np

AMOSTRAS = 400
LEITURAS = 6
SEMENTE = 42
RUIDO_LEITURA = 0.3
RUIDO_ALVO = 0.2
SAIDA = Path(__file__).resolve().parent / 'temperatura.csv'


def main() -> None:
    rng = np.random.default_rng(SEMENTE)
    base = rng.uniform(12, 28, size=AMOSTRAS)
    tendencia = rng.uniform(-0.3, 0.3, size=AMOSTRAS)
    amplitude = rng.uniform(1.5, 4.0, size=AMOSTRAS)
    inicio = rng.uniform(0, 24, size=AMOSTRAS)

    horas = inicio[:, None] + np.arange(LEITURAS + 1)[None, :]
    ciclo = amplitude[:, None] * np.sin(2 * np.pi * (horas - 14) / 24)
    temperatura = base[:, None] + tendencia[:, None] * np.arange(LEITURAS + 1)[None, :] + ciclo
    leituras = temperatura[:, :LEITURAS] + rng.normal(0, RUIDO_LEITURA, size=(AMOSTRAS, LEITURAS))
    alvo = temperatura[:, LEITURAS] + rng.normal(0, RUIDO_ALVO, size=AMOSTRAS)

    linhas = ['rotulo,' + ','.join(f'f{i}' for i in range(LEITURAS))]
    for r, valores in zip(alvo, leituras):
        linhas.append(f'{r:.2f},' + ','.join(f'{v:.2f}' for v in valores))
    SAIDA.write_text('\n'.join(linhas) + '\n', encoding='utf-8')
    print(f'{SAIDA.name}: {AMOSTRAS} linhas ({SAIDA.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
