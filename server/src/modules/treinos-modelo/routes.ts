import { access } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Response } from 'express';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirInterno, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { gerarSlug, slugUnico } from '../../lib/slug';
import {
  buscarModelo,
  montarConfig,
  paraTreino,
  paraTreinoResumo,
  validarCompatibilidade,
  type TreinoCompleto,
} from '../modelos/comum';
import type { ConfigModelo, TarefaModelo, TipoModelo, Artefato } from '../modelos/padroes';
import { AGENTE_LLM_PADRAO } from '../agentes/padroes';
import { despacharTreino } from './despachar';
import { cancelarAjusteOpenai } from './openai';
import { iniciarWorkerOpenai } from './worker';

const router = Router();

// Sincroniza os ajustes da OpenAI em segundo plano (idempotente).
iniciarWorkerOpenai();

const STATUS_TREINO = ['FILA', 'EXECUTANDO', 'SUCESSO', 'FALHA', 'CANCELADO'] as const;

const treinarSchema = z.object({
  datasetId: z.number().int().positive().optional(),
  parametros: z.record(z.string(), z.unknown()).optional(),
});

const callbackSchema = z.object({
  status: z.enum(STATUS_TREINO).optional(),
  log: z.string().optional(),
  metricas: z.record(z.string(), z.unknown()).optional(),
  artefatos: z
    .array(
      z.object({
        nome: z.string(),
        tipo: z.string(),
        caminho: z.string(),
        tamanhoBytes: z.number().nonnegative(),
      }),
    )
    .optional(),
  modeloResultante: z.string().nullable().optional(),
  externoId: z.string().nullable().optional(),
});

// Busca o treino completo (com log, parâmetros e artefatos) ou 404.
async function buscarTreinoCompleto(id: number): Promise<TreinoCompleto> {
  const treino = await prisma.treinoModelo.findUnique({ where: { id } });
  if (!treino) throw new ErroHttp(404, 'Treino não encontrado');
  return treino;
}

async function buscarTreinoComModelo(id: number) {
  const treino = await prisma.treinoModelo.findUnique({
    where: { id },
    include: { modelo: true },
  });
  if (!treino) throw new ErroHttp(404, 'Treino não encontrado');
  return treino;
}

// Envia o arquivo de um artefato (caminho relativo a /data) para download.
async function enviarArtefato(res: Response, next: NextFunction, artefato: Artefato): Promise<void> {
  // O caminho vem do callback: não confiar nele; deve ficar dentro de DATA_DIR.
  // Resolve sem criar pastas e só então confere que fica dentro de DATA_DIR.
  const abs = path.resolve(config.dataDir, artefato.caminho);
  if (!abs.startsWith(path.resolve(config.dataDir) + path.sep)) {
    throw new ErroHttp(400, 'Caminho de artefato inválido');
  }
  const caminho = abs;
  await access(caminho).catch(() => {
    throw new ErroHttp(404, 'Arquivo do artefato não disponível');
  });
  res.download(caminho, artefato.nome, (erro) => {
    if (erro && !res.headersSent) next(erro);
  });
}

// POST /modelos/:id/treinar — cria o TreinoModelo (FILA) e despacha ao serviço do tipo.
router.post(
  '/modelos/:id/treinar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const modelo = await buscarModelo(req.params.id);
    const corpo = treinarSchema.parse(req.body ?? {});

    const datasetId = corpo.datasetId ?? modelo.datasetId;
    if (!datasetId) throw new ErroHttp(400, 'Escolha um dataset');

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset) throw new ErroHttp(404, 'Dataset não encontrado');

    const tipo = modelo.tipo as TipoModelo;
    const tarefa = modelo.tarefa as TarefaModelo;
    validarCompatibilidade(tipo, tarefa, dataset.tipo);

    const parametros = montarConfig(tipo, modelo.config as unknown as ConfigModelo, corpo.parametros);

    const ultimo = await prisma.treinoModelo.findFirst({
      where: { modeloId: modelo.id },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const numero = (ultimo?.numero ?? 0) + 1;

    const treino = await prisma.treinoModelo.create({
      data: {
        modeloId: modelo.id,
        numero,
        datasetId,
        status: 'FILA',
        parametros: parametros as unknown as Prisma.InputJsonObject,
      },
    });
    await registrar(req.usuario?.id ?? null, 'treino-modelo.criar', `${modelo.nome} (treino ${numero})`);

    await despacharTreino(treino.id);

    res.status(201).json(paraTreino(await buscarTreinoCompleto(treino.id)));
  }),
);

// GET /modelos/:id/treinos — já vem carregado com o modelo (buscarModelo), em ordem numero desc.
router.get(
  '/modelos/:id/treinos',
  autenticar,
  rota(async (req, res) => {
    const modelo = await buscarModelo(req.params.id);
    res.json(modelo.treinos.map((t) => paraTreinoResumo(t)));
  }),
);

// GET /treinos-modelo/:id
router.get(
  '/treinos-modelo/:id',
  autenticar,
  rota(async (req, res) => {
    res.json(paraTreino(await buscarTreinoCompleto(idParam(req))));
  }),
);

// POST /treinos-modelo/:id/cancelar — só FILA/EXECUTANDO.
router.post(
  '/treinos-modelo/:id/cancelar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const id = idParam(req);
    const treino = await buscarTreinoComModelo(id);
    if (treino.status !== 'FILA' && treino.status !== 'EXECUTANDO') {
      throw new ErroHttp(400, 'Só é possível cancelar treinos em fila ou em execução');
    }
    if (treino.modelo.tipo === 'LLM_NUVEM') {
      try {
        await cancelarAjusteOpenai(id);
      } catch (erro) {
        // Mantém EXECUTANDO: o worker sincroniza o status real com a OpenAI.
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        throw new ErroHttp(400, 'A OpenAI recusou o cancelamento: ' + mensagem);
      }
    }
    // Só grava se ainda estiver ativo: um callback que chegou antes já pode ter finalizado o treino.
    await prisma.treinoModelo.updateMany({
      where: { id, status: { in: ['FILA', 'EXECUTANDO'] } },
      data: { status: 'CANCELADO', finalizadoEm: new Date() },
    });
    await registrar(req.usuario?.id ?? null, 'treino-modelo.cancelar', `treino #${id}`);
    res.json(paraTreino(await buscarTreinoCompleto(id)));
  }),
);

// POST /treinos-modelo/:id/publicar — só SUCESSO; desmarca os outros treinos do mesmo modelo.
router.post(
  '/treinos-modelo/:id/publicar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const id = idParam(req);
    const treino = await buscarTreinoCompleto(id);
    if (treino.status !== 'SUCESSO') {
      throw new ErroHttp(400, 'Só treinos concluídos com sucesso podem ser publicados');
    }
    await prisma.$transaction([
      prisma.treinoModelo.updateMany({
        where: { modeloId: treino.modeloId, publicado: true },
        data: { publicado: false },
      }),
      prisma.treinoModelo.update({ where: { id }, data: { publicado: true } }),
    ]);
    await registrar(req.usuario?.id ?? null, 'treino-modelo.publicar', `treino #${id}`);
    res.json(paraTreino(await buscarTreinoCompleto(id)));
  }),
);

// GET /treinos-modelo/:id/artefatos/:nome — download (o nome tem que estar em artefatos).
router.get(
  '/treinos-modelo/:id/artefatos/:nome',
  autenticar,
  rota(async (req, res, next) => {
    const treino = await buscarTreinoCompleto(idParam(req));
    const nome = String(req.params.nome);
    const artefatos = (Array.isArray(treino.artefatos) ? treino.artefatos : []) as Artefato[];
    const artefato = artefatos.find((a) => a.nome === nome);
    if (!artefato) throw new ErroHttp(404, 'Artefato não encontrado');
    await enviarArtefato(res, next, artefato);
  }),
);

// POST /treinos-modelo/:id/criar-agente — só LLM_* com SUCESSO e modeloResultante; cria Agente LLM.
router.post(
  '/treinos-modelo/:id/criar-agente',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const treino = await buscarTreinoComModelo(idParam(req));
    const tipo = treino.modelo.tipo;
    if (tipo !== 'LLM_NUVEM' && tipo !== 'LLM_LOCAL') {
      throw new ErroHttp(400, 'Só modelos LLM podem gerar um agente');
    }
    if (treino.status !== 'SUCESSO' || !treino.modeloResultante) {
      throw new ErroHttp(400, 'O treino precisa estar concluído com sucesso e ter um modelo resultante');
    }

    const parametros = (treino.parametros ?? {}) as { promptSistema?: unknown };
    const promptSistema = typeof parametros.promptSistema === 'string' ? parametros.promptSistema : '';
    const nome = `${treino.modelo.nome} v${treino.numero}`;
    const slug = await slugUnico(gerarSlug(nome), async (s) => {
      return (await prisma.agente.findUnique({ where: { slug: s }, select: { id: true } })) !== null;
    });
    const provedor = tipo === 'LLM_NUVEM' ? 'OPENAI' : 'OLLAMA';

    const agente = await prisma.$transaction(async (tx) => {
      const criado = await tx.agente.create({
        data: {
          nome,
          slug,
          descricao: '',
          tipo: 'LLM',
          provedor,
          modelo: treino.modeloResultante,
          promptSistema,
          esforco: AGENTE_LLM_PADRAO.esforco,
          temperatura: AGENTE_LLM_PADRAO.temperatura,
          maxTokens: AGENTE_LLM_PADRAO.maxTokens,
          ferramentas: [],
          autorId: req.usuario?.id ?? null,
        },
      });
      await tx.versaoAgente.create({
        data: {
          agenteId: criado.id,
          versao: 1,
          nota: 'Criado a partir do modelo',
          snapshot: JSON.parse(JSON.stringify(criado)) as Prisma.InputJsonValue,
        },
      });
      return criado;
    });

    await registrar(req.usuario?.id ?? null, 'treino-modelo.criar-agente', `${agente.nome} (${agente.slug})`);
    res.status(201).json(agente);
  }),
);

// POST /interno/treinos-modelo/:id — callback do trainer/finetuner/worker OpenAI (X-Interno-Token).
// Ignora tudo se o treino já estiver CANCELADO.
router.post(
  '/interno/treinos-modelo/:id',
  exigirInterno,
  rota(async (req, res) => {
    const id = idParam(req);
    const corpo = callbackSchema.parse(req.body ?? {});
    const treino = await buscarTreinoCompleto(id);
    if (treino.status === 'CANCELADO') {
      res.status(204).end();
      return;
    }

    const dados: Prisma.TreinoModeloUpdateManyMutationInput = {};
    if (corpo.status) {
      dados.status = corpo.status;
      if (corpo.status === 'EXECUTANDO' && !treino.iniciadoEm) dados.iniciadoEm = new Date();
      if (corpo.status === 'SUCESSO' || corpo.status === 'FALHA' || corpo.status === 'CANCELADO') {
        dados.finalizadoEm = new Date();
      }
    }
    if (corpo.log) dados.log = treino.log ? `${treino.log}\n${corpo.log}` : corpo.log;
    if (corpo.metricas) {
      const atuais =
        treino.metricas && typeof treino.metricas === 'object' && !Array.isArray(treino.metricas)
          ? (treino.metricas as Record<string, unknown>)
          : {};
      dados.metricas = { ...atuais, ...corpo.metricas } as unknown as Prisma.InputJsonObject;
    }
    if (corpo.artefatos) dados.artefatos = corpo.artefatos as unknown as Prisma.InputJsonValue;
    if (corpo.modeloResultante !== undefined) dados.modeloResultante = corpo.modeloResultante;
    if (corpo.externoId !== undefined) dados.externoId = corpo.externoId;

    // updateMany com filtro: um cancelamento que chegou no meio da requisição não é sobrescrito.
    await prisma.treinoModelo.updateMany({
      where: { id, status: { not: 'CANCELADO' } },
      data: dados,
    });
    res.status(204).end();
  }),
);

export default router;
