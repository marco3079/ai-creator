import { config as configServidor } from '../../../lib/config';
import type { ConfigExecucao, Executor, MensagemChat, UsoTokens } from './tipos';

export const MODELOS_OPENAI = ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];

const URL_CHAT = 'https://api.openai.com/v1/chat/completions';

function mensagemDeErro(texto: string, status: number): string {
  try {
    const dados = JSON.parse(texto) as { error?: { message?: string } };
    return `Erro da OpenAI (${status}): ${dados.error?.message ?? texto}`;
  } catch {
    return `Erro da OpenAI (${status}): ${texto || 'sem detalhes'}`;
  }
}

// OpenAI: chat completions em streaming (SSE). O uso vem no último pedaço por causa de include_usage.
export const executarOpenai: Executor = async (
  config: ConfigExecucao,
  mensagens: MensagemChat[],
  aoTexto: (texto: string) => void,
  sinal: AbortSignal,
): Promise<UsoTokens> => {
  const chave = configServidor.openaiChave;
  if (!chave) throw new Error('OPENAI_API_KEY não configurada no servidor (.env).');

  const historico: { role: 'system' | 'user' | 'assistant'; content: string }[] = config.promptSistema
    ? [{ role: 'system', content: config.promptSistema }, ...mensagens]
    : mensagens;

  const corpo = {
    model: config.modelo || MODELOS_OPENAI[0],
    stream: true,
    stream_options: { include_usage: true },
    messages: historico,
    ...(config.temperatura != null ? { temperature: config.temperatura } : {}),
    ...(config.maxTokens ? { max_completion_tokens: config.maxTokens } : {}),
  };

  const resposta = await fetch(URL_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify(corpo),
    signal: sinal,
  });

  if (!resposta.ok || !resposta.body) {
    const texto = await resposta.text().catch(() => '');
    throw new Error(mensagemDeErro(texto, resposta.status));
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  let uso: UsoTokens = { entrada: 0, saida: 0 };
  let fim = false;

  const processarLinha = (linhaBruta: string) => {
    const linha = linhaBruta.trim();
    if (!linha.startsWith('data:')) return;
    const dados = linha.slice(5).trim();
    if (dados === '[DONE]') {
      fim = true;
      return;
    }
    const pedaco = JSON.parse(dados) as {
      error?: { message?: string };
      choices?: { delta?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    if (pedaco.error) throw new Error(`Erro da OpenAI: ${pedaco.error.message ?? 'falha desconhecida'}`);
    const texto = pedaco.choices?.[0]?.delta?.content;
    if (texto) aoTexto(texto);
    if (pedaco.usage) {
      uso = { entrada: pedaco.usage.prompt_tokens ?? 0, saida: pedaco.usage.completion_tokens ?? 0 };
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
