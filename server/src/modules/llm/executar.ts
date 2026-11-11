import type { Executor } from './provedores/tipos';
import { executarAnthropic } from './provedores/anthropic';
import { executarOpenai } from './provedores/openai';
import { executarOllama } from './provedores/ollama';

// Escolhe o executor do provedor do agente.
export function executorDe(p: 'ANTHROPIC' | 'OPENAI' | 'OLLAMA'): Executor {
  switch (p) {
    case 'ANTHROPIC':
      return executarAnthropic;
    case 'OPENAI':
      return executarOpenai;
    case 'OLLAMA':
      return executarOllama;
  }
}
