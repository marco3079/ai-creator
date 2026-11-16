// Simulador de coleta: gera linhas no mesmo formato do firmware COLETOR (3 canais, 50 Hz), sem placa.
import type { MetadadosColeta } from '../../lib/tipos-melhorias';

export type GestoSimulado = 'parado' | 'acenar' | 'circulo';

export const GESTOS_SIMULADOS: { valor: GestoSimulado; rotulo: string }[] = [
  { valor: 'parado', rotulo: 'Parado' },
  { valor: 'acenar', rotulo: 'Acenar' },
  { valor: 'circulo', rotulo: 'Círculo' },
];

export const CANAIS_SIMULADOS = 3;
export const HZ_SIMULADOS = 50;
export const NOMES_SIMULADOS = ['ax', 'ay', 'az'];

/** Linha de metadados que o firmware COLETOR imprime (formato do §6 dos contratos). */
export const METADADO_SIMULADO = `# AIC-COLETA canais=${CANAIS_SIMULADOS} hz=${HZ_SIMULADOS} nomes=${NOMES_SIMULADOS.join(',')}`;

/** Lê uma linha "# AIC-COLETA canais=<n> hz=<hz> nomes=<a,b,c>". Devolve null se não for esse formato. */
export function interpretarMetadado(linha: string): MetadadosColeta | null {
  if (!linha.startsWith('# AIC-COLETA')) return null;
  const canais = /canais=(\d+)/.exec(linha);
  const hz = /hz=(\d+(?:\.\d+)?)/.exec(linha);
  const nomes = /nomes=([^\s]+)/.exec(linha);
  if (!canais || !hz) return null;
  return {
    canais: Number(canais[1]),
    hz: Number(hz[1]),
    nomes: nomes ? nomes[1].split(',') : [],
  };
}

// Ruído uniforme em [-amplitude, +amplitude].
function ruido(amplitude: number): number {
  return (Math.random() * 2 - 1) * amplitude;
}

/**
 * Valores dos 3 canais no instante t (segundos) para o gesto. Unidades em "g" (aceleração).
 * - parado: gravidade em z, quase sem movimento
 * - acenar: oscilação de vaivém em x (2 Hz)
 * - circulo: trajetória circular no plano xy (1 Hz)
 */
export function amostraSimulada(gesto: GestoSimulado, t: number): number[] {
  const ruidoBase = 0.03;
  if (gesto === 'acenar') {
    const fase = 2 * Math.PI * 2 * t;
    return [
      0.8 * Math.sin(fase) + ruido(ruidoBase),
      0.2 * Math.sin(fase / 2) + ruido(ruidoBase),
      1 + 0.1 * Math.cos(fase) + ruido(ruidoBase),
    ];
  }
  if (gesto === 'circulo') {
    const fase = 2 * Math.PI * 1 * t;
    return [
      0.7 * Math.cos(fase) + ruido(ruidoBase),
      0.7 * Math.sin(fase) + ruido(ruidoBase),
      1 + 0.05 * Math.sin(2 * fase) + ruido(ruidoBase),
    ];
  }
  return [ruido(0.02), ruido(0.02), 1 + ruido(0.02)];
}

/** Linha de dados "v1,v2,v3" (3 casas decimais) para o gesto no instante t. */
export function linhaSimulada(gesto: GestoSimulado, t: number): string {
  return amostraSimulada(gesto, t)
    .map((v) => v.toFixed(3))
    .join(',');
}
