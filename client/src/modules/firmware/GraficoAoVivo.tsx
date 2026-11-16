// Gráfico de linhas ao vivo em SVG próprio (sem biblioteca). Uma linha por canal, cores por classe CSS.

export const PONTOS_GRAFICO = 200;

const LARGURA = 600;
const PADDING = 8;

/**
 * pontos: uma linha por amostra, com um valor por canal (o mais recente por último).
 * nomes: rótulo de cada canal (legenda).
 */
export function GraficoAoVivo({
  nomes,
  pontos,
  altura = 200,
}: {
  nomes: string[];
  pontos: number[][];
  altura?: number;
}) {
  const canais = Math.max(nomes.length, pontos[0]?.length ?? 0);

  let min = Infinity;
  let max = -Infinity;
  for (const linha of pontos) {
    for (const v of linha) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = -1;
    max = 1;
  }
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }

  const passoX = (LARGURA - 2 * PADDING) / (PONTOS_GRAFICO - 1);
  // Os pontos mais recentes ficam à direita; o gráfico começa vazio à esquerda.
  const inicio = PONTOS_GRAFICO - pontos.length;

  function y(v: number): number {
    return PADDING + (1 - (v - min) / (max - min)) * (altura - 2 * PADDING);
  }

  const trilhas: string[] = [];
  for (let c = 0; c < canais; c++) {
    trilhas.push(
      pontos
        .map((linha, i) => {
          const x = PADDING + (inicio + i) * passoX;
          return `${x.toFixed(1)},${y(linha[c] ?? 0).toFixed(1)}`;
        })
        .join(' ')
    );
  }

  return (
    <div className="grafico-ao-vivo">
      <svg
        className="grafico-svg"
        viewBox={`0 0 ${LARGURA} ${altura}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Gráfico dos sinais ao vivo"
      >
        <line className="grafico-eixo" x1={PADDING} x2={LARGURA - PADDING} y1={y(0)} y2={y(0)} />
        {trilhas.map((pts, c) =>
          pts ? <polyline key={c} className={`grafico-canal grafico-canal-${c % 6}`} points={pts} /> : null
        )}
      </svg>
      <div className="grafico-legenda">
        {Array.from({ length: canais }, (_, c) => (
          <span key={c} className="grafico-legenda-item">
            <span className={`grafico-amostra grafico-canal-${c % 6}`} aria-hidden="true" />
            {nomes[c] ?? `canal ${c}`}
          </span>
        ))}
        <span className="grafico-escala">
          {min.toFixed(2)} a {max.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
