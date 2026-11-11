// Contrato comum dos provedores de LLM (ANTHROPIC, OPENAI, OLLAMA).

export interface MensagemChat {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConfigExecucao {
  modelo: string;
  promptSistema: string;
  esforco?: string | null; // só ANTHROPIC: low | medium | high | xhigh | max
  temperatura?: number | null; // só OPENAI / OLLAMA
  maxTokens?: number | null;
}

export interface UsoTokens {
  entrada: number;
  saida: number;
}

// Executa o agente em streaming: chama aoTexto a cada pedaço de texto e devolve o uso ao final.
// Lança Error com mensagem em português quando o provedor falha ou recusa.
export type Executor = (
  config: ConfigExecucao,
  mensagens: MensagemChat[],
  aoTexto: (texto: string) => void,
  sinal: AbortSignal,
) => Promise<UsoTokens>;
