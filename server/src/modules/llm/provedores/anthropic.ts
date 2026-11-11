import Anthropic from '@anthropic-ai/sdk';
import type { Executor } from './tipos';

// Modelos Claude oferecidos no editor. O padrão é claude-opus-5-5.
export const MODELOS_ANTHROPIC = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
];

export const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

// Modelos que aceitam o fallback automático do servidor quando o pedido é recusado.
const COM_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

let cliente: Anthropic | null = null;

function obterCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor (.env).');
  }
  cliente ??= new Anthropic();
  return cliente;
}

// Claude: thinking adaptativo sempre ligado; o controle de profundidade é o "esforço".
// temperature/top_p não são enviados (os modelos atuais recusam esses parâmetros).
export const executarAnthropic: Executor = async (config, mensagens, aoTexto, sinal) => {
  const anthropic = obterCliente();
  const esforco = ESFORCOS.includes(config.esforco as (typeof ESFORCOS)[number])
    ? config.esforco
    : 'high';

  const parametros: Record<string, unknown> = {
    model: config.modelo || 'claude-opus-5-5',
    max_tokens: config.maxTokens && config.maxTokens > 0 ? config.maxTokens : 64000,
    system: config.promptSistema || undefined,
    thinking: { type: 'adaptive' },
    output_config: { effort: esforco },
    messages: mensagens,
  };

  const usarFallback = COM_FALLBACK.has(String(parametros.model));
  if (usarFallback) {
    parametros.betas = ['server-side-fallback-2026-07-01'];
    parametros.fallbacks = 'default';
  }

  // O tipo exato dos parâmetros varia entre versões do SDK; o corpo segue a API documentada.
  async function rodar(): Promise<{ stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }> {
    if (usarFallback) {
      const fluxo = anthropic.beta.messages.stream(parametros as never, { signal: sinal });
      fluxo.on('text', (texto: string) => aoTexto(texto));
      return fluxo.finalMessage();
    }
    const fluxo = anthropic.messages.stream(parametros as never, { signal: sinal });
    fluxo.on('text', (texto: string) => aoTexto(texto));
    return fluxo.finalMessage();
  }

  try {
    const final = await rodar();
    if (final.stop_reason === 'refusal') {
      throw new Error('O modelo recusou este pedido. Reformule a mensagem.');
    }
    return { entrada: final.usage.input_tokens, saida: final.usage.output_tokens };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da Anthropic inválida.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de uso da Anthropic atingido. Tente de novo em instantes.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Modelo não encontrado: ${String(parametros.model)}`);
    if (e instanceof Anthropic.APIError) throw new Error(`Erro da Anthropic: ${e.message}`);
    throw e;
  }
};
