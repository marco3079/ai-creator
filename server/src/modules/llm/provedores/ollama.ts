import { config as configServidor } from '../../../lib/config';
import type { ConfigExecucao, Executor, MensagemChat, UsoTokens } from './tipos';

// Consulta os modelos instalados no Ollama. Retorna null se o Ollama não respondeu (timeout de 2 s).
async function buscarTags(): Promise<string[] | null> {
  try {
    const resposta = await fetch(`${configServidor.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { models?: { name: string }[] };
    return (dados.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

export async function listarModelosOllama(): Promise<string[]> {
  return (await buscarTags()) ?? [];
}

export async function ollamaRespondeu(): Promise<boolean> {
  return (await buscarTags()) !== null;
}

// Ollama: /api/chat em NDJSON (uma linha JSON por pedaço). O último pedaço traz done e os contadores de tokens.
export const executarOllama: Executor = async (
  config: ConfigExecucao,
  mensagens: MensagemChat[],
  aoTexto: (texto: string) => void,
  sinal: AbortSignal,
): Promise<UsoTokens> => {
  const historico: { role: 'system' | 'user' | 'assistant'; content: string }[] = config.promptSistema
    ? [{ role: 'system', content: config.promptSistema }, ...mensagens]
    : mensagens;

  const corpo = {
    model: config.modelo,
    messages: historico,
    stream: true,
    options: {
      temperature: config.temperatura ?? undefined,
      num_predict: config.maxTokens ?? undefined,
    },
  };

  let resposta: Response;
  try {
    resposta = await fetch(`${configServidor.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: sinal,
    });
  } catch (e) {
    if (sinal.aborted) throw e;
    throw new Error(`Não foi possível conectar ao Ollama em ${configServidor.ollamaUrl}.`);
  }

  if (!resposta.ok || !resposta.body) {
    const texto = await resposta.text().catch(() => '');
    throw new Error(`Erro do Ollama (${resposta.status}): ${texto || 'sem detalhes'}`);
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  let uso: UsoTokens = { entrada: 0, saida: 0 };
  let fim = false;

  const processarLinha = (linhaBruta: string) => {
    const linha = linhaBruta.trim();
    if (!linha) return;
    const pedaco = JSON.parse(linha) as {
      error?: string;
      message?: { content?: string };
      done?: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (pedaco.error) throw new Error(`Erro do Ollama: ${pedaco.error}`);
    if (pedaco.message?.content) aoTexto(pedaco.message.content);
    if (pedaco.done) {
      uso = { entrada: pedaco.prompt_eval_count ?? 0, saida: pedaco.eval_count ?? 0 };
      fim = true;
    }
  };

  while (!fim) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    let quebra: number;
    while (!fim && (quebra = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, quebra);
      buffer = buffer.slice(quebra + 1);
      processarLinha(linha);
    }
  }
  if (!fim && buffer.trim()) processarLinha(buffer);

  return uso;
};
