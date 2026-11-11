import fs from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { caminhoDados } from '../../lib/arquivos';

// Ajuste fino (fine-tuning) de modelos LLM_NUVEM na API da OpenAI. Ver CONTRATOS-MODELOS §4.

// Base da API; trocável só em testes via definirBaseOpenai.
let BASE_OPENAI = 'https://api.openai.com/v1';

export function definirBaseOpenai(url: string): void {
  BASE_OPENAI = url;
}

interface JobOpenai {
  id: string;
  status: string;
  fine_tuned_model: string | null;
  trained_tokens: number | null;
  error?: { message?: string } | null;
}

interface EventoOpenai {
  id: string;
  created_at: number;
  level?: string;
  type?: string;
  message: string;
  data?: { step?: number; train_loss?: number; valid_loss?: number; [chave: string]: unknown };
}

interface ParamsJob {
  training_file: string;
  model: string;
  suffix?: string;
  method: unknown;
}

// Campos de config (parametros do treino) usados no ajuste.
interface ConfigLlmNuvem {
  modeloBase?: string;
  epocas?: number | null;
  tamanhoLote?: number | null;
  multiplicadorTaxa?: number | null;
  sufixo?: string;
  promptSistema?: string;
}

// Métricas guardadas pelo ajuste na OpenAI (somam-se às do contrato).
interface MetricasOpenai {
  ultimoEventoId?: string;
  historico?: { epoca: number; perda: number; perdaValidacao?: number }[];
  tokensTreinados?: number;
  principal?: { nome: string; rotulo: string; valor: number; formato: string };
  [chave: string]: unknown;
}

// ---------- Parte HTTP (funções puras, testáveis com definirBaseOpenai) ----------

async function pedir<T>(
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: { json?: unknown; formulario?: FormData }
): Promise<T> {
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${config.openaiChave}` };
  let conteudo: BodyInit | undefined;
  if (corpo?.json !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    conteudo = JSON.stringify(corpo.json);
  }
  if (corpo?.formulario) conteudo = corpo.formulario;

  const resposta = await fetch(`${BASE_OPENAI}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: conteudo,
    signal: AbortSignal.timeout(120_000),
  });
  const dados = (await resposta.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  // Erro HTTP: a mensagem da própria OpenAI vai para o log do treino.
  if (!resposta.ok) {
    throw new Error(dados?.error?.message ?? `OpenAI respondeu HTTP ${resposta.status}`);
  }
  return dados as T;
}

// Envia o JSONL como arquivo de fine-tuning; devolve o id do arquivo.
export async function enviarArquivo(buffer: Buffer): Promise<string> {
  const formulario = new FormData();
  formulario.append('file', new Blob([buffer], { type: 'application/jsonl' }), 'treino.jsonl');
  formulario.append('purpose', 'fine-tune');
  const arquivo = await pedir<{ id: string }>('POST', '/files', { formulario });
  return arquivo.id;
}

export async function criarJob(params: ParamsJob): Promise<JobOpenai> {
  return pedir<JobOpenai>('POST', '/fine_tuning/jobs', { json: params });
}

export async function lerJob(id: string): Promise<JobOpenai> {
  return pedir<JobOpenai>('GET', `/fine_tuning/jobs/${encodeURIComponent(id)}`);
}

export async function lerEventos(id: string): Promise<EventoOpenai[]> {
  const lista = await pedir<{ data: EventoOpenai[] }>(
    'GET',
    `/fine_tuning/jobs/${encodeURIComponent(id)}/events?limit=50`
  );
  return lista.data;
}

export async function cancelarJob(id: string): Promise<JobOpenai> {
  return pedir<JobOpenai>('POST', `/fine_tuning/jobs/${encodeURIComponent(id)}/cancel`);
}

// ---------- Fluxo do treino ----------

// Linha de log com horário, no formato usado pelos demais treinos.
function linha(mensagem: string, quando: Date = new Date()): string {
  return `[${quando.toLocaleTimeString('pt-BR')}] ${mensagem}\n`;
}

// Acrescenta texto ao log (lendo o atual) e grava campos extras no mesmo update.
// Não sobrescreve treino CANCELADO (m02 pode ter cancelado no meio do fluxo).
async function registrar(
  treinoId: number,
  texto: string,
  dados: Prisma.TreinoModeloUpdateManyMutationInput = {}
): Promise<void> {
  const atual = await prisma.treinoModelo.findUnique({ where: { id: treinoId }, select: { log: true } });
  await prisma.treinoModelo.updateMany({
    where: { id: treinoId, status: { not: 'CANCELADO' } },
    data: { ...dados, log: (atual?.log ?? '') + texto },
  });
}

// Envia o dataset e cria o job. Em caso de erro, o treino vira FALHA com a mensagem.
export async function iniciarAjusteOpenai(treinoId: number): Promise<void> {
  try {
    if (!config.openaiChave) {
      throw new Error('OPENAI_API_KEY não configurada no servidor (.env).');
    }
    const treino = await prisma.treinoModelo.findUnique({
      where: { id: treinoId },
      include: { modelo: true },
    });
    if (!treino) throw new Error('Treino não encontrado');

    // Parâmetros efetivos do treino, com o config do modelo por trás.
    const cfg: ConfigLlmNuvem = {
      ...((treino.modelo.config ?? {}) as ConfigLlmNuvem),
      ...((treino.parametros ?? {}) as ConfigLlmNuvem),
    };
    if (!cfg.modeloBase) throw new Error('Modelo base não informado.');

    const datasetId = treino.datasetId ?? treino.modelo.datasetId;
    const dataset = datasetId
      ? await prisma.dataset.findUnique({ where: { id: datasetId } })
      : null;
    if (!dataset || dataset.tipo !== 'CONVERSAS') {
      throw new Error('Escolha um dataset de conversas (JSONL) para o ajuste na OpenAI.');
    }

    const origem = path.join(config.dataDir, dataset.caminhoArquivo);
    const promptSistema = cfg.promptSistema?.trim() ?? '';
    let conteudo: Buffer;
    if (promptSistema) {
      // Insere a mensagem system no início das conversas que não têm uma e grava o JSONL gerado.
      const temporario = caminhoDados('treinos', String(treinoId), 'openai-treino.jsonl');
      const saida = fs
        .readFileSync(origem, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => {
          const conversa = JSON.parse(l) as { messages: { role: string; content: string }[] };
          if (!conversa.messages.some((m) => m.role === 'system')) {
            conversa.messages.unshift({ role: 'system', content: promptSistema });
          }
          return JSON.stringify(conversa);
        });
      fs.writeFileSync(temporario, saida.join('\n') + '\n');
      conteudo = fs.readFileSync(temporario);
    } else {
      conteudo = fs.readFileSync(origem);
    }

    const idArquivo = await enviarArquivo(conteudo);
    await registrar(treinoId, linha(`Arquivo enviado à OpenAI (${idArquivo}).`));

    // Valores vazios viram 'auto', que a OpenAI escolhe sozinha.
    const job = await criarJob({
      training_file: idArquivo,
      model: cfg.modeloBase,
      ...(cfg.sufixo ? { suffix: cfg.sufixo } : {}),
      method: {
        type: 'supervised',
        supervised: {
          hyperparameters: {
            n_epochs: cfg.epocas ?? 'auto',
            batch_size: cfg.tamanhoLote ?? 'auto',
            learning_rate_multiplier: cfg.multiplicadorTaxa ?? 'auto',
          },
        },
      },
    });
    await registrar(treinoId, linha(`Job criado na OpenAI (${job.id}, modelo base ${cfg.modeloBase}).`), {
      status: 'EXECUTANDO',
      externoId: job.id,
    });

    // Se foi cancelado enquanto enviava, o job criado não pode ficar órfão na OpenAI.
    const relido = await prisma.treinoModelo.findUnique({ where: { id: treinoId }, select: { status: true } });
    if (relido?.status === 'CANCELADO') {
      try {
        await cancelarJob(job.id);
      } catch (erro) {
        console.error(`[openai] falha ao cancelar job órfão ${job.id}:`, erro);
      }
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await registrar(treinoId, linha(`Erro: ${mensagem}`), {
      status: 'FALHA',
      finalizadoEm: new Date(),
    }).catch((e) => console.error('[openai] falha ao registrar erro do treino', e));
  }
}

// Função pura: a partir da lista de eventos (a API devolve do mais novo para o mais antigo)
// e das métricas já guardadas, devolve o texto novo do log e as métricas atualizadas.
export function processarEventos(
  eventos: EventoOpenai[],
  metricasAtuais: MetricasOpenai
): { texto: string; metricas: MetricasOpenai; novos: number } {
  const metricas: MetricasOpenai = { ...metricasAtuais };

  // Ordem cronológica: a API devolve do mais novo para o mais antigo, então basta inverter.
  // Eventos com o mesmo created_at ficam na ordem certa.
  const cronologicos = [...eventos].reverse();
  const indiceUltimo = metricas.ultimoEventoId
    ? cronologicos.findIndex((e) => e.id === metricas.ultimoEventoId)
    : -1;
  // Se ultimoEventoId não está na lista (mais de 50 eventos novos), os 50 são registrados de novo. Aceito.
  const novos = cronologicos.slice(indiceUltimo + 1);

  let texto = '';
  const historico = [...(metricas.historico ?? [])];
  for (const evento of novos) {
    texto += linha(evento.message, new Date(evento.created_at * 1000));
    // Eventos "metrics" trazem a perda por passo.
    if (evento.type === 'metrics' && typeof evento.data?.step === 'number' && typeof evento.data.train_loss === 'number') {
      historico.push({
        epoca: evento.data.step,
        perda: evento.data.train_loss,
        ...(typeof evento.data.valid_loss === 'number' ? { perdaValidacao: evento.data.valid_loss } : {}),
      });
    }
  }
  if (cronologicos.length > 0) metricas.ultimoEventoId = cronologicos[cronologicos.length - 1].id;
  if (historico.length > 0) metricas.historico = historico;
  return { texto, metricas, novos: novos.length };
}

// Atualiza um treino em execução com o estado do job na OpenAI.
async function sincronizarUm(treino: {
  id: number;
  externoId: string | null;
  log: string;
  metricas: Prisma.JsonValue;
}): Promise<void> {
  if (!treino.externoId) return;
  const [job, eventos] = await Promise.all([lerJob(treino.externoId), lerEventos(treino.externoId)]);

  const processado = processarEventos(eventos, (treino.metricas ?? {}) as MetricasOpenai);
  const metricas = processado.metricas;
  let texto = processado.texto;

  const dados: Prisma.TreinoModeloUpdateManyMutationInput = {};
  if (job.status === 'succeeded') {
    const tokens = job.trained_tokens ?? 0;
    metricas.tokensTreinados = tokens;
    metricas.principal = { nome: 'tokensTreinados', rotulo: 'Tokens treinados', valor: tokens, formato: 'numero' };
    texto += linha('Ajuste concluído na OpenAI.');
    Object.assign(dados, {
      status: 'SUCESSO',
      modeloResultante: job.fine_tuned_model,
      finalizadoEm: new Date(),
    });
  } else if (job.status === 'failed') {
    texto += linha(`Job falhou na OpenAI: ${job.error?.message ?? 'erro desconhecido'}`);
    Object.assign(dados, { status: 'FALHA', finalizadoEm: new Date() });
  } else if (job.status === 'cancelled') {
    texto += linha('Job cancelado na OpenAI.');
    Object.assign(dados, { status: 'CANCELADO', finalizadoEm: new Date() });
  }

  // Sem novidade no log nem no estado: não grava nada.
  if (texto === '' && !('status' in dados) && processado.novos === 0) return;

  // updateMany com status != CANCELADO: não sobrescreve um cancelamento feito pelo m02.
  const atual = await prisma.treinoModelo.findUnique({ where: { id: treino.id }, select: { log: true } });
  await prisma.treinoModelo.updateMany({
    where: { id: treino.id, status: { not: 'CANCELADO' } },
    data: {
      ...dados,
      metricas: metricas as Prisma.InputJsonValue,
      log: (atual?.log ?? '') + texto,
    },
  });
}

// Percorre os treinos de LLM_NUVEM em execução; um erro num não impede os outros.
export async function sincronizarAjustesOpenai(): Promise<void> {
  const treinos = await prisma.treinoModelo.findMany({
    where: { status: 'EXECUTANDO', externoId: { not: null }, modelo: { tipo: 'LLM_NUVEM' } },
  });
  for (const treino of treinos) {
    try {
      await sincronizarUm(treino);
    } catch (erro) {
      console.error(`[openai] falha ao sincronizar treino ${treino.id}:`, erro);
    }
  }
}

// Pede o cancelamento do job. Erros da OpenAI são lançados para quem chamou decidir o status.
export async function cancelarAjusteOpenai(treinoId: number): Promise<void> {
  const treino = await prisma.treinoModelo.findUnique({ where: { id: treinoId } });
  if (!treino?.externoId) return;
  await cancelarJob(treino.externoId);
  await registrar(treinoId, linha('Cancelamento solicitado à OpenAI.'));
}
