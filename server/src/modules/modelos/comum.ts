// Funções compartilhadas da área "Modelos". O m02 (treinos-modelo) importa estas funções: manter os nomes.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ErroHttp } from '../../lib/erros';
import {
  Artefato,
  ConfigModelo,
  DATASETS_POR_TIPO,
  MetricaPrincipal,
  MetricasModelo,
  ModeloResumo,
  TAREFAS_POR_TIPO,
  TarefaModelo,
  TipoDataset,
  TipoModelo,
  configPadrao,
} from './padroes';
import { esquemaConfig } from './esquemas';

// Relações carregadas junto com o modelo (sem o log dos treinos, que pode ser grande).
export const incluirModelo = {
  dataset: { select: { id: true, nome: true, tipo: true, classes: true, amostras: true } },
  treinos: {
    orderBy: { numero: 'desc' as const },
    select: {
      id: true,
      modeloId: true,
      numero: true,
      datasetId: true,
      status: true,
      metricas: true,
      modeloResultante: true,
      publicado: true,
      criadoEm: true,
      iniciadoEm: true,
      finalizadoEm: true,
      artefatos: true,
    },
  },
} satisfies Prisma.ModeloInclude;

export type ModeloComRelacoes = Prisma.ModeloGetPayload<{ include: typeof incluirModelo }>;
export type TreinoComRelacoes = ModeloComRelacoes['treinos'][number];

// Treino completo (com log, parâmetros e artefatos), usado por paraTreino.
export interface TreinoCompleto {
  id: number;
  modeloId: number;
  numero: number;
  datasetId: number | null;
  status: string;
  parametros: unknown;
  metricas: unknown;
  log: string;
  artefatos: unknown;
  externoId: string | null;
  modeloResultante: string | null;
  publicado: boolean;
  criadoEm: Date;
  iniciadoEm: Date | null;
  finalizadoEm: Date | null;
}

const TIPOS_ARTEFATO_MODELO = ['TFLITE', 'JOBLIB', 'ADAPTER'];

// Busca por id numérico ou slug. 404 se não existir.
export async function buscarModelo(idOuSlug: string | number): Promise<ModeloComRelacoes> {
  const texto = String(idOuSlug);
  const modelo = /^\d+$/.test(texto)
    ? await prisma.modelo.findUnique({ where: { id: Number(texto) }, include: incluirModelo })
    : await prisma.modelo.findUnique({ where: { slug: texto }, include: incluirModelo });
  if (!modelo) throw new ErroHttp(404, 'Modelo não encontrado');
  return modelo;
}

function principalDe(metricas: unknown): MetricaPrincipal | null {
  const m = metricas as MetricasModelo | null;
  return m?.principal ?? null;
}

function iso(data: Date | null): string | null {
  return data ? data.toISOString() : null;
}

// Soma dos artefatos de modelo (TFLITE, JOBLIB, ADAPTER); null se não houver nenhum.
export function tamanhoModeloBytes(artefatos: unknown): number | null {
  const lista = (Array.isArray(artefatos) ? artefatos : []) as Artefato[];
  const modelos = lista.filter((a) => TIPOS_ARTEFATO_MODELO.includes(a.tipo));
  if (modelos.length === 0) return null;
  return modelos.reduce((soma, a) => soma + (Number(a.tamanhoBytes) || 0), 0);
}

// ModeloResumo (GET /modelos).
export function paraResumo(m: ModeloComRelacoes): ModeloResumo {
  const publicado = m.treinos.find((t) => t.publicado);
  const ultimo = m.treinos[0];
  return {
    id: m.id,
    nome: m.nome,
    slug: m.slug,
    descricao: m.descricao,
    tipo: m.tipo as TipoModelo,
    tarefa: m.tarefa as TarefaModelo,
    tags: m.tags,
    dataset: m.dataset ? { id: m.dataset.id, nome: m.dataset.nome, tipo: m.dataset.tipo as TipoDataset } : null,
    totalTreinos: m.treinos.length,
    ultimoTreino: ultimo ? { id: ultimo.id, numero: ultimo.numero, status: ultimo.status } : null,
    publicado: publicado
      ? { id: publicado.id, numero: publicado.numero, principal: principalDe(publicado.metricas) }
      : null,
    atualizadoEm: m.atualizadoEm.toISOString(),
  };
}

// TreinoModeloResumo (lista de treinos).
export function paraTreinoResumo(t: TreinoComRelacoes | TreinoCompleto) {
  return {
    id: t.id,
    modeloId: t.modeloId,
    numero: t.numero,
    status: t.status,
    datasetId: t.datasetId,
    metricas: (t.metricas as MetricasModelo | null) ?? null,
    modeloResultante: t.modeloResultante,
    publicado: t.publicado,
    criadoEm: t.criadoEm.toISOString(),
    iniciadoEm: iso(t.iniciadoEm),
    finalizadoEm: iso(t.finalizadoEm),
    tamanhoBytes: tamanhoModeloBytes(t.artefatos),
  };
}

// TreinoModelo (detalhe do treino). Recebe o treino com todas as colunas.
export function paraTreino(t: TreinoCompleto) {
  return {
    ...paraTreinoResumo(t),
    parametros: t.parametros as ConfigModelo,
    log: t.log,
    artefatos: (Array.isArray(t.artefatos) ? t.artefatos : []) as Artefato[],
    externoId: t.externoId,
  };
}

// Modelo (GET /modelos/:id): resumo + config + dataset detalhado + treinos.
export function paraModelo(m: ModeloComRelacoes) {
  const resumo = paraResumo(m);
  return {
    id: resumo.id,
    nome: resumo.nome,
    slug: resumo.slug,
    descricao: resumo.descricao,
    tipo: resumo.tipo,
    tarefa: resumo.tarefa,
    tags: resumo.tags,
    totalTreinos: resumo.totalTreinos,
    ultimoTreino: resumo.ultimoTreino,
    publicado: resumo.publicado,
    atualizadoEm: resumo.atualizadoEm,
    datasetId: m.datasetId,
    dataset: m.dataset
      ? { id: m.dataset.id, nome: m.dataset.nome, tipo: m.dataset.tipo as TipoDataset, classes: m.dataset.classes, amostras: m.dataset.amostras }
      : null,
    config: m.config as unknown as ConfigModelo,
    criadoEm: m.criadoEm.toISOString(),
    treinos: m.treinos.map((t) => paraTreinoResumo(t)),
  };
}

// Confere tarefa × tipo do modelo e (se informado) tipo do dataset × tipo do modelo (CONTRATOS-MODELOS §1).
export function validarCompatibilidade(tipo: TipoModelo, tarefa: TarefaModelo, datasetTipo?: string | null): void {
  if (!TAREFAS_POR_TIPO[tipo].includes(tarefa)) {
    throw new ErroHttp(400, `A tarefa ${tarefa} não se aplica ao tipo ${tipo}.`);
  }
  if (!datasetTipo) return;
  const aceitos = DATASETS_POR_TIPO[tipo];
  if (!aceitos.includes(datasetTipo as TipoDataset)) {
    throw new ErroHttp(
      400,
      `O dataset do tipo ${datasetTipo} não serve para o modelo ${tipo} (aceitos: ${aceitos.join(', ')}).`
    );
  }
  // Tarefa de imagens precisa de dataset de imagens, e dataset de imagens só serve à tarefa IMAGEM.
  if (tarefa === 'IMAGEM' && datasetTipo !== 'IMAGENS') {
    throw new ErroHttp(400, 'A tarefa de classificação de imagens precisa de um dataset de IMAGENS.');
  }
  if (tarefa !== 'IMAGEM' && datasetTipo === 'IMAGENS') {
    throw new ErroHttp(400, 'Dataset de IMAGENS só serve à tarefa de classificação de imagens.');
  }
}

const CHAVES_SUBSTITUIDAS = new Set(['hiperparametros']);

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Mescla profunda: objetos se mesclam; arrays, valores e `hiperparametros` são substituídos.
function mesclar(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...base };
  for (const chave of Object.keys(extra)) {
    const valor = extra[chave];
    if (valor === undefined) continue;
    if (ehObjeto(valor) && ehObjeto(base[chave]) && !CHAVES_SUBSTITUIDAS.has(chave)) {
      saida[chave] = mesclar(base[chave] as Record<string, unknown>, valor);
    } else {
      saida[chave] = valor;
    }
  }
  return saida;
}

// Aplica o parcial sobre a base (padrão do tipo/tarefa ou config atual) e valida pelo esquema do tipo.
// Erros de validação viram ZodError (400 com a primeira mensagem).
export function montarConfig(
  tipo: TipoModelo,
  base: ConfigModelo,
  parcial?: Record<string, unknown> | null
): ConfigModelo {
  const mesclado = parcial ? mesclar(base as unknown as Record<string, unknown>, parcial) : base;
  return esquemaConfig(tipo).parse(mesclado) as ConfigModelo;
}

// Config padrão já validada para tipo/tarefa com o parcial aplicado.
export function configInicial(tipo: TipoModelo, tarefa: TarefaModelo, parcial?: Record<string, unknown> | null): ConfigModelo {
  return montarConfig(tipo, configPadrao(tipo, tarefa), parcial);
}
