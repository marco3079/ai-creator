import type { StatusJob, TipoModelo } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitirEvento, type TipoTrabalho } from '../../lib/eventos';
import { enviarTreinoAgente } from '../treinos/routes';
import { enviarBuild } from '../projetos/build';
import { enviarTreinoModelo } from '../treinos-modelo/despachar';
import {
  MENSAGEM_INDISPONIVEL,
  NOMES_SERVICOS,
  capacidadeDe,
  type NomeServico,
  type ResultadoEnvio,
} from './servicos';

// Despachante da fila (CONTRATOS-MELHORIAS §1). A fila está no Postgres: FILA → EXECUTANDO é a reserva.
// Nenhuma rota envia ao serviço diretamente; as rotas só criam a linha em FILA e chamam acordarFila().

const CICLO_MS = 3_000;
const ESPERA_NOVA_TENTATIVA_MS = 15_000;
const TENTATIVAS_MAXIMAS = 20;

// Tipos de TreinoModelo que cada serviço executa (builder não executa treinos de modelo).
const TIPOS_MODELO: Record<NomeServico, TipoModelo[]> = {
  trainer: ['TINYML', 'TABULAR'],
  builder: [],
  finetuner: ['LLM_LOCAL'],
  openai: ['LLM_NUVEM'],
};

// Um trabalho da fila, de qualquer uma das três tabelas.
export interface Item {
  tipo: TipoTrabalho;
  id: number;
  servico: NomeServico;
  criadoEm: Date;
  vinculo: { agenteId?: number | null; modeloId?: number | null; projetoId?: number | null };
}

// Campos gravados nas três tabelas (todas têm estes campos com o mesmo nome).
interface Campos {
  status?: StatusJob;
  log?: string;
  tentativas?: number;
  iniciadoEm?: Date | null;
  finalizadoEm?: Date | null;
}

let rodando = false; // impede ciclos sobrepostos
let pendente = false; // um ciclo foi pedido enquanto outro rodava
let agendado = false; // já há um ciclo imediato na fila do event loop
let iniciado = false; // impede dois timers

function desligada(): boolean {
  return process.env.FILA_DESLIGADA === '1';
}

// Agenda um ciclo imediato (sem sobrepor). Chamado pelas rotas depois de criar uma linha em FILA.
export function acordarFila(): void {
  if (desligada() || agendado) return;
  agendado = true;
  setImmediate(() => {
    agendado = false;
    void ciclo();
  });
}

// Liga o ciclo periódico (a cada 3 s). Idempotente. Não faz nada com FILA_DESLIGADA=1 (testes).
export function iniciarFila(): void {
  if (iniciado || desligada()) return;
  iniciado = true;
  setInterval(() => {
    void ciclo();
  }, CICLO_MS);
}

async function ciclo(): Promise<void> {
  if (rodando) {
    pendente = true;
    return;
  }
  rodando = true;
  try {
    do {
      pendente = false;
      await cicloUmaVez();
    } while (pendente);
  } catch (erro) {
    console.error('[fila] falha no ciclo:', erro);
  } finally {
    rodando = false;
  }
}

// Quantos trabalhos estão em cada status (FILA ou EXECUTANDO), por serviço.
async function contarPor(status: StatusJob): Promise<Record<NomeServico, number>> {
  const contagem: Record<NomeServico, number> = { trainer: 0, builder: 0, finetuner: 0, openai: 0 };
  contagem.trainer += await prisma.treino.count({ where: { status } });
  contagem.builder += await prisma.build.count({ where: { status } });
  for (const nome of NOMES_SERVICOS) {
    const tipos = TIPOS_MODELO[nome];
    if (tipos.length === 0) continue;
    contagem[nome] += await prisma.treinoModelo.count({ where: { status, modelo: { tipo: { in: tipos } } } });
  }
  return contagem;
}

// Situação da fila por serviço (usada por GET /fila).
export async function situacaoFila(): Promise<Record<NomeServico, { executando: number; naFila: number }>> {
  const executando = await contarPor('EXECUTANDO');
  const naFila = await contarPor('FILA');
  const situacao = {} as Record<NomeServico, { executando: number; naFila: number }>;
  for (const nome of NOMES_SERVICOS) {
    situacao[nome] = { executando: executando[nome], naFila: naFila[nome] };
  }
  return situacao;
}

// Próximos FILA de um serviço, do mais antigo para o mais novo. Respeita a espera de 15 s entre tentativas.
async function candidatos(nome: NomeServico, limite: number): Promise<Item[]> {
  const corte = new Date(Date.now() - ESPERA_NOVA_TENTATIVA_MS);
  const itens: Item[] = [];

  if (nome === 'trainer') {
    const treinos = await prisma.treino.findMany({
      where: { status: 'FILA', OR: [{ tentativas: 0 }, { atualizadoEm: { lte: corte } }] },
      orderBy: { criadoEm: 'asc' },
      take: limite,
      select: { id: true, criadoEm: true, agenteId: true },
    });
    for (const t of treinos) {
      itens.push({ tipo: 'treino', id: t.id, servico: nome, criadoEm: t.criadoEm, vinculo: { agenteId: t.agenteId } });
    }
  }

  if (nome === 'builder') {
    const builds = await prisma.build.findMany({
      where: { status: 'FILA', OR: [{ tentativas: 0 }, { atualizadoEm: { lte: corte } }] },
      orderBy: { criadoEm: 'asc' },
      take: limite,
      select: { id: true, criadoEm: true, projetoId: true },
    });
    for (const b of builds) {
      itens.push({ tipo: 'build', id: b.id, servico: nome, criadoEm: b.criadoEm, vinculo: { projetoId: b.projetoId } });
    }
  }

  const tipos = TIPOS_MODELO[nome];
  if (tipos.length > 0) {
    const modelos = await prisma.treinoModelo.findMany({
      where: {
        status: 'FILA',
        OR: [{ tentativas: 0 }, { atualizadoEm: { lte: corte } }],
        modelo: { tipo: { in: tipos } },
      },
      orderBy: { criadoEm: 'asc' },
      take: limite,
      select: { id: true, criadoEm: true, modeloId: true },
    });
    for (const m of modelos) {
      itens.push({ tipo: 'treinoModelo', id: m.id, servico: nome, criadoEm: m.criadoEm, vinculo: { modeloId: m.modeloId } });
    }
  }

  return itens.sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime()).slice(0, limite);
}

// updateMany com o status esperado no where: se outro ciclo mudou a linha, devolve 0 e não sobrescreve.
export async function atualizarItem(item: Item, esperado: StatusJob, campos: Campos): Promise<number> {
  const onde = { id: item.id, status: esperado };
  switch (item.tipo) {
    case 'treino':
      return (await prisma.treino.updateMany({ where: onde, data: campos })).count;
    case 'build':
      return (await prisma.build.updateMany({ where: onde, data: campos })).count;
    case 'treinoModelo':
      return (await prisma.treinoModelo.updateMany({ where: onde, data: campos })).count;
  }
}

// Lê o log e as tentativas atuais; null se a linha sumiu.
export async function lerAtual(item: Item): Promise<{ log: string; tentativas: number } | null> {
  const selecao = { log: true, tentativas: true } as const;
  switch (item.tipo) {
    case 'treino':
      return prisma.treino.findUnique({ where: { id: item.id }, select: selecao });
    case 'build':
      return prisma.build.findUnique({ where: { id: item.id }, select: selecao });
    case 'treinoModelo':
      return prisma.treinoModelo.findUnique({ where: { id: item.id }, select: selecao });
  }
}

export function acrescentar(logAtual: string, mensagem: string): string {
  return logAtual ? `${logAtual}\n${mensagem}` : mensagem;
}

export function publicar(item: Item, status: StatusJob): void {
  emitirEvento({ tipo: item.tipo, id: item.id, status, ...item.vinculo });
}

// Reserva o trabalho (FILA → EXECUTANDO). Devolve false se outro ciclo já pegou.
async function reclamar(item: Item): Promise<boolean> {
  const movidos = await atualizarItem(item, 'FILA', { status: 'EXECUTANDO', iniciadoEm: new Date() });
  if (movidos === 0) return false;
  publicar(item, 'EXECUTANDO');
  return true;
}

// Envio ao serviço certo. Não muda status: quem muda é processar().
async function enviar(item: Item): Promise<ResultadoEnvio> {
  switch (item.tipo) {
    case 'treino':
      return enviarTreinoAgente(item.id);
    case 'build':
      return enviarBuild(item.id);
    case 'treinoModelo':
      return enviarTreinoModelo(item.id);
  }
}

async function falhar(item: Item, logAtual: string, mensagem: string): Promise<void> {
  const movidos = await atualizarItem(item, 'EXECUTANDO', {
    status: 'FALHA',
    log: acrescentar(logAtual, mensagem),
    finalizadoEm: new Date(),
  });
  if (movidos > 0) publicar(item, 'FALHA');
}

// Trata o resultado do envio: ok não mexe; indisponível volta para FILA (até 20 vezes); erro vira FALHA.
async function processar(item: Item): Promise<void> {
  try {
    let resultado: ResultadoEnvio;
    try {
      resultado = await enviar(item);
    } catch (erro) {
      resultado = { erro: erro instanceof Error ? erro.message : String(erro) };
    }
    if (resultado === 'ok') return;

    const atual = await lerAtual(item);
    if (!atual) return;

    if (resultado !== 'indisponivel') {
      await falhar(item, atual.log, resultado.erro);
      return;
    }

    const numero = atual.tentativas + 1;
    if (numero >= TENTATIVAS_MAXIMAS) {
      await falhar(item, atual.log, MENSAGEM_INDISPONIVEL[item.servico]);
      return;
    }
    const movidos = await atualizarItem(item, 'EXECUTANDO', {
      status: 'FILA',
      tentativas: numero,
      iniciadoEm: null,
      log: acrescentar(
        atual.log,
        `Serviço ${item.servico} indisponível; nova tentativa em instantes (${numero}/${TENTATIVAS_MAXIMAS}).`,
      ),
    });
    if (movidos > 0) publicar(item, 'FILA');
  } catch (erro) {
    console.error(`[fila] falha ao processar ${item.tipo} #${item.id}:`, erro);
  }
}

async function cicloUmaVez(): Promise<void> {
  const ocupados = await contarPor('EXECUTANDO');
  await Promise.all(
    NOMES_SERVICOS.map(async (nome) => {
      try {
        const vagas = capacidadeDe(nome) - ocupados[nome];
        if (vagas <= 0) return;
        for (const item of await candidatos(nome, vagas)) {
          if (await reclamar(item)) {
            // Não espera o envio: o trabalho já está EXECUTANDO e conta nas vagas do próximo ciclo.
            void processar(item);
          }
        }
      } catch (erro) {
        console.error(`[fila] falha ao despachar para ${nome}:`, erro);
      }
    }),
  );
}
