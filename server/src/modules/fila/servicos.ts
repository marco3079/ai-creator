import { config } from '../../lib/config';

// Serviços que executam trabalhos (CONTRATOS-MELHORIAS §1). O openai não tem URL: é a API da OpenAI.
export type NomeServico = 'trainer' | 'builder' | 'finetuner' | 'openai';

export const NOMES_SERVICOS: NomeServico[] = ['trainer', 'builder', 'finetuner', 'openai'];

export const MSG_FINETUNER = 'Serviço finetuner indisponível. Suba com: docker compose --profile gpu up -d finetuner';

// Mensagem gravada no log quando o serviço esgota as tentativas.
export const MENSAGEM_INDISPONIVEL: Record<NomeServico, string> = {
  trainer: 'Serviço de treino indisponível',
  builder: 'Serviço de compilação indisponível',
  finetuner: MSG_FINETUNER,
  openai: 'Serviço da OpenAI indisponível',
};

// Lê um inteiro positivo do ambiente; senão usa o padrão.
function inteiroEnv(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

// Vagas simultâneas por serviço (env: FILA_TRAINER, FILA_BUILDER, FILA_FINETUNER; openai fixo em 5).
export function capacidadeDe(nome: NomeServico): number {
  switch (nome) {
    case 'trainer':
      return inteiroEnv('FILA_TRAINER', 1);
    case 'builder':
      return inteiroEnv('FILA_BUILDER', 2);
    case 'finetuner':
      return inteiroEnv('FILA_FINETUNER', 1);
    case 'openai':
      return 5;
  }
}

// URL base do serviço (sem barra no fim). openai não tem URL local.
export function urlDe(nome: NomeServico): string | null {
  switch (nome) {
    case 'trainer':
      return config.trainerUrl;
    case 'builder':
      return config.builderUrl;
    case 'finetuner':
      return config.finetunerUrl;
    case 'openai':
      return null;
  }
}

// Ids dos trabalhos ativos no serviço (GET /trabalhos).
export interface TrabalhosAtivos {
  treinos: number[];
  treinosModelo: number[];
  builds: number[];
}

// Pergunta ao serviço o que ele está executando. Devolve null se estiver offline, com timeout de 3 s ou com erro.
export async function trabalhosAtivos(nome: NomeServico): Promise<TrabalhosAtivos | null> {
  const url = urlDe(nome);
  if (!url) return null;
  try {
    const resposta = await fetch(`${url}/trabalhos`, { signal: AbortSignal.timeout(3_000) });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as Partial<Record<keyof TrabalhosAtivos, unknown>>;
    const numeros = (valor: unknown): number[] =>
      Array.isArray(valor) ? valor.filter((n): n is number => typeof n === 'number') : [];
    return {
      treinos: numeros(dados.treinos),
      treinosModelo: numeros(dados.treinosModelo),
      builds: numeros(dados.builds),
    };
  } catch {
    return null;
  }
}

// Serviço está online? O openai depende só da chave configurada.
export async function servicoOnline(nome: NomeServico): Promise<boolean> {
  if (nome === 'openai') return Boolean(config.openaiChave);
  return (await trabalhosAtivos(nome)) !== null;
}

// Resultado de enviar um pedido a um serviço: ok, indisponível (conexão, timeout ou 5xx) ou erro definitivo (4xx).
export type ResultadoEnvio = 'ok' | 'indisponivel' | { erro: string };

// POST JSON ao serviço. Conexão/timeout/5xx viram 'indisponivel' (nova tentativa); 4xx vira erro com o corpo.
export async function enviarPedido(url: string, corpo: unknown, timeoutMs: number): Promise<ResultadoEnvio> {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!resposta) return 'indisponivel';
  if (resposta.ok) return 'ok';
  if (resposta.status >= 500) return 'indisponivel';
  const texto = await resposta.text().catch(() => '');
  return { erro: texto.trim() || `Serviço respondeu HTTP ${resposta.status}` };
}
