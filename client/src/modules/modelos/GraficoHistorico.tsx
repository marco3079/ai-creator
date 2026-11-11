import type { MetricasModelo } from '../../lib/tipos-modelos';

// Gráfico de perda e métrica por época, em SVG próprio (sem biblioteca).
// Cada linha usa a própria escala (mín..máx da série), por isso a legenda mostra o início e o fim de cada uma.
// As cores vêm das classes det-serie-* (variáveis CSS), para funcionar no claro e no escuro.

type Historico = NonNullable<MetricasModelo['historico']>;

const LARGURA = 600;
const ALTURA = 220;
const ESQ = 44;
const DIR = 580;
const TOPO = 16;
const BASE = 186;

interface Serie {
  rotulo: string;
  classe: string;
  valores: (number | null)[];
}

function formatarValor(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function desenharSerie(valores: (number | null)[]): { caminho: string; pontos: { x: number; y: number }[] } {
  const validos = valores.filter((v): v is number => v !== null);
  if (validos.length === 0) return { caminho: '', pontos: [] };
  const menor = Math.min(...validos);
  const maior = Math.max(...validos);
  const amplitude = maior - menor || 1;
  const n = valores.length;
  const pontos: { x: number; y: number }[] = [];
  valores.forEach((v, i) => {
    if (v === null) return;
    const x = n <= 1 ? (ESQ + DIR) / 2 : ESQ + (i * (DIR - ESQ)) / (n - 1);
    const y = BASE - ((v - menor) / amplitude) * (BASE - TOPO);
    pontos.push({ x, y });
  });
  const caminho = pontos
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  return { caminho, pontos };
}

export function GraficoHistorico({
  historico,
  rotuloMetrica,
}: {
  historico: Historico;
  rotuloMetrica: string;
}) {
  if (historico.length === 0) return null;

  const perda = historico.map((h) => (typeof h.perda === 'number' ? h.perda : null));
  const metrica = historico.map((h) => {
    if (typeof h.metrica === 'number') return h.metrica;
    if (typeof h.metricaValidacao === 'number') return h.metricaValidacao;
    return null;
  });

  const series: Serie[] = [{ rotulo: 'Perda', classe: 'det-serie-perda', valores: perda }];
  if (metrica.some((v) => v !== null)) {
    series.push({ rotulo: rotuloMetrica, classe: 'det-serie-metrica', valores: metrica });
  } else {
    // Sem métrica no histórico: a segunda linha vira a perda de validação.
    const perdaValidacao = historico.map((h) => (typeof h.perdaValidacao === 'number' ? h.perdaValidacao : null));
    if (perdaValidacao.some((v) => v !== null)) {
      series.push({ rotulo: 'Perda (val.)', classe: 'det-serie-metrica', valores: perdaValidacao });
    }
  }

  const n = historico.length;
  const primeiraEpoca = historico[0].epoca;
  const ultimaEpoca = historico[n - 1].epoca;

  return (
    <figure className="det-grafico">
      <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} role="img" aria-label="Perda e métrica por época" className="det-grafico-svg">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = BASE - f * (BASE - TOPO);
          return <line key={f} x1={ESQ} x2={DIR} y1={y} y2={y} className="det-grade" />;
        })}
        <text x={ESQ} y={ALTURA - 8} className="det-eixo">
          época {primeiraEpoca}
        </text>
        <text x={DIR} y={ALTURA - 8} textAnchor="end" className="det-eixo">
          época {ultimaEpoca}
        </text>

        {series.map((s) => {
          const { caminho, pontos } = desenharSerie(s.valores);
          return (
            <g key={s.classe} className={s.classe}>
              {caminho && <path d={caminho} className="det-linha-serie" />}
              {pontos.map((p, k) => (
                <circle key={k} cx={p.x} cy={p.y} r={3} className="det-ponto" />
              ))}
            </g>
          );
        })}
      </svg>

      <figcaption className="det-legenda">
        {series.map((s) => {
          const validos = s.valores.filter((v): v is number => v !== null);
          const inicio = validos[0];
          const fim = validos[validos.length - 1];
          return (
            <span key={s.classe} className={`det-legenda-item ${s.classe}`}>
              <i aria-hidden="true" />
              {s.rotulo}
              {inicio !== undefined && fim !== undefined && (
                <small>
                  {' '}
                  {formatarValor(inicio)} → {formatarValor(fim)}
                </small>
              )}
            </span>
          );
        })}
        <small className="det-legenda-nota">Cada linha usa a própria escala.</small>
      </figcaption>
    </figure>
  );
}
