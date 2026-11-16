// Contrato das ferramentas que um agente LLM pode chamar durante a execução (escrito pelo main).
import type { z } from 'zod';
import type { ConfigExecucao, MensagemChat, UsoTokens } from './tipos';

export interface DefinicaoFerramenta {
  nome: string; // nome exposto ao modelo: só [a-zA-Z0-9_-] (ex.: "ler_arquivo")
  descricao: string;
  esquema: Record<string, unknown>; // JSON Schema do objeto de entrada (type: 'object')
  validar: z.ZodTypeAny; // validação da entrada antes de executar
}

export interface ResultadoFerramenta {
  conteudo: string; // texto devolvido ao modelo (cortar em ~20 000 caracteres)
  erro?: boolean;
}

export type EventoFerramenta =
  | { tipo: 'ferramenta'; id: string; nome: string; entrada: string; fase: 'inicio' }
  | { tipo: 'ferramenta'; id: string; nome: string; resultado: string; erro: boolean; fase: 'fim' };

export interface UsoComFerramentas extends UsoTokens {
  ferramentas: number; // quantas chamadas de ferramenta foram executadas
}

// Executa o agente em laço: o modelo pode chamar ferramentas várias vezes até responder.
export type ExecutorComFerramentas = (
  config: ConfigExecucao,
  mensagens: MensagemChat[],
  ferramentas: DefinicaoFerramenta[],
  executar: (nome: string, entrada: unknown) => Promise<ResultadoFerramenta>,
  aoTexto: (texto: string) => void,
  aoEvento: (evento: EventoFerramenta) => void,
  sinal: AbortSignal,
) => Promise<UsoComFerramentas>;

export const MAX_RODADAS_FERRAMENTAS = 15;

export function resumir(texto: string, limite = 300): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}
