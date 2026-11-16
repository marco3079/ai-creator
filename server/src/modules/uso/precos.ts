// Preços de LLM (USD por 1M tokens) e cálculo de custo (CONTRATOS-MELHORIAS §7).
// Padrão da plataforma; Plataforma.precosLlm sobrescreve ou acrescenta modelos.

export type PrecoLlm = { entrada: number; saida: number };
export type PrecosLlm = Record<string, PrecoLlm>;

export const PRECOS_PADRAO: PrecosLlm = {
  'claude-opus-5-5': { entrada: 4, saida: 20 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5 },
  'claude-fable-5-2': { entrada: 8, saida: 40 },
  'claude-opus-5': { entrada: 5, saida: 25 },
};

// Preço do modelo: o personalizado tem prioridade sobre o padrão. Null se não houver preço.
export function precoDe(modelo: string, personalizados: PrecosLlm = {}): PrecoLlm | null {
  const personalizado = personalizados[modelo];
  if (personalizado) return personalizado;
  return PRECOS_PADRAO[modelo] ?? null;
}

// Custo em USD de uma execução: tokens de entrada e saída a preço por 1M tokens.
export function calcularCusto(preco: PrecoLlm, entrada: number, saida: number): number {
  return (entrada * preco.entrada + saida * preco.saida) / 1_000_000;
}
