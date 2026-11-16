import type { TipoModelo } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { atualizarItem, acrescentar, lerAtual, publicar, type Item } from './despachante';
import { trabalhosAtivos, type NomeServico, type TrabalhosAtivos } from './servicos';

// Vigia da fila (CONTRATOS-MELHORIAS §1): acha trabalhos EXECUTANDO que o serviço perdeu
// (reinício) ou que passaram do tempo limite, e marca FALHA.

const PRIMEIRA_VARREDURA_MS = 10_000;
const INTERVALO_MS = 60_000;
const CARENCIA_PERDIDO_MS = 2 * 60_000; // evita falso positivo para trabalho recém-enviado

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const LIMITE_BUILD = { ms: 30 * MINUTO, rotulo: '30 min' };
const LIMITE_TREINO = { ms: 2 * HORA, rotulo: '2 h' };
const LIMITE_LLM_LOCAL = { ms: 12 * HORA, rotulo: '12 h' };

// Tipos de TreinoModelo que cada serviço executa.
const TIPOS_TRAINER: TipoModelo[] = ['TINYML', 'TABULAR'];

type Grupo = keyof TrabalhosAtivos;

interface Linha {
  item: Item;
  grupo: Grupo; // lista de ids do /trabalhos em que o trabalho deve aparecer
  atualizadoEm: Date;
  iniciadoEm: Date | null;
  limite: { ms: number; rotulo: string };
}

let iniciado = false;
let rodando = false;

function desligada(): boolean {
  return process.env.FILA_DESLIGADA === '1';
}

// Todos os trabalhos EXECUTANDO de um serviço (trainer, builder ou finetuner).
async function executandoDo(nome: Exclude<NomeServico, 'openai'>): Promise<Linha[]> {
  const linhas: Linha[] = [];

  if (nome === 'trainer') {
    const treinos = await prisma.treino.findMany({
      where: { status: 'EXECUTANDO' },
      select: { id: true, criadoEm: true, agenteId: true, atualizadoEm: true, iniciadoEm: true },
    });
    for (const t of treinos) {
      linhas.push({
        item: { tipo: 'treino', id: t.id, servico: nome, criadoEm: t.criadoEm, vinculo: { agenteId: t.agenteId } },
        grupo: 'treinos',
        atualizadoEm: t.atualizadoEm,
        iniciadoEm: t.iniciadoEm,
        limite: LIMITE_TREINO,
      });
    }
  }

  if (nome === 'builder') {
    const builds = await prisma.build.findMany({
      where: { status: 'EXECUTANDO' },
      select: { id: true, criadoEm: true, projetoId: true, atualizadoEm: true, iniciadoEm: true },
    });
    for (const b of builds) {
      linhas.push({
        item: { tipo: 'build', id: b.id, servico: nome, criadoEm: b.criadoEm, vinculo: { projetoId: b.projetoId } },
        grupo: 'builds',
        atualizadoEm: b.atualizadoEm,
        iniciadoEm: b.iniciadoEm,
        limite: LIMITE_BUILD,
      });
    }
  }

  const tipos: TipoModelo[] = nome === 'trainer' ? TIPOS_TRAINER : nome === 'finetuner' ? ['LLM_LOCAL'] : [];
  if (tipos.length > 0) {
    const modelos = await prisma.treinoModelo.findMany({
      where: { status: 'EXECUTANDO', modelo: { tipo: { in: tipos } } },
      select: { id: true, criadoEm: true, modeloId: true, atualizadoEm: true, iniciadoEm: true },
    });
    for (const m of modelos) {
      linhas.push({
        item: { tipo: 'treinoModelo', id: m.id, servico: nome, criadoEm: m.criadoEm, vinculo: { modeloId: m.modeloId } },
        grupo: 'treinosModelo',
        atualizadoEm: m.atualizadoEm,
        iniciadoEm: m.iniciadoEm,
        limite: nome === 'finetuner' ? LIMITE_LLM_LOCAL : LIMITE_TREINO,
      });
    }
  }

  return linhas;
}

// Motivo para marcar FALHA, ou null se o trabalho segue normal.
function motivoDeFalha(linha: Linha, ativos: TrabalhosAtivos | null, agora: number): string | null {
  if (linha.iniciadoEm && agora - linha.iniciadoEm.getTime() > linha.limite.ms) {
    return `Tempo limite excedido (${linha.limite.rotulo}).`;
  }
  const perdido =
    ativos !== null &&
    !ativos[linha.grupo].includes(linha.item.id) &&
    agora - linha.atualizadoEm.getTime() > CARENCIA_PERDIDO_MS;
  if (perdido) {
    return `O serviço ${linha.item.servico} reiniciou e o trabalho foi perdido. Rode de novo.`;
  }
  return null;
}

// Marca FALHA só se ainda estiver EXECUTANDO (não sobrescreve o que mudou no meio).
async function falharPelaVigia(item: Item, mensagem: string): Promise<void> {
  const atual = await lerAtual(item);
  if (!atual) return;
  const movidos = await atualizarItem(item, 'EXECUTANDO', {
    status: 'FALHA',
    log: acrescentar(atual.log, mensagem),
    finalizadoEm: new Date(),
  });
  if (movidos > 0) publicar(item, 'FALHA');
}

async function varrerServico(nome: Exclude<NomeServico, 'openai'>, agora: number): Promise<void> {
  try {
    const ativos = await trabalhosAtivos(nome); // null: serviço fora do ar (só o tempo limite vale)
    for (const linha of await executandoDo(nome)) {
      try {
        const motivo = motivoDeFalha(linha, ativos, agora);
        if (motivo) {
          console.warn(`[vigia] ${linha.item.tipo} #${linha.item.id}: ${motivo}`);
          await falharPelaVigia(linha.item, motivo);
        }
      } catch (erro) {
        console.error(`[vigia] falha ao verificar ${linha.item.tipo} #${linha.item.id}:`, erro);
      }
    }
  } catch (erro) {
    console.error(`[vigia] falha ao verificar o serviço ${nome}:`, erro);
  }
}

async function varrer(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    const agora = Date.now();
    for (const nome of ['trainer', 'builder', 'finetuner'] as const) {
      await varrerServico(nome, agora);
    }
  } finally {
    rodando = false;
  }
}

// Liga a vigia: primeira varredura 10 s depois de subir e depois a cada 60 s. Idempotente.
// Não faz nada com FILA_DESLIGADA=1 (testes).
export function iniciarVigia(): void {
  if (iniciado || desligada()) return;
  iniciado = true;
  setTimeout(() => {
    void varrer();
    setInterval(() => {
      void varrer();
    }, INTERVALO_MS);
  }, PRIMEIRA_VARREDURA_MS);
}
