import { access } from 'node:fs/promises';
import type { NextFunction, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirInterno, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';

const router = Router();

const PLACAS = [
  'ESP32',
  'ESP32S3',
  'ARDUINO_NANO33BLE',
  'ARDUINO_UNO',
  'STM32_NUCLEO_F401RE',
  'RP2040_PICO',
] as const;

// ConfigTinyml (CONTRATOS §2) para validar o config final antes de enviar ao trainer.
const configSchema = z.object({
  tarefa: z.literal('CLASSIFICACAO'),
  entrada: z.object({
    tipo: z.enum(['SERIE_TEMPORAL', 'AUDIO', 'TABELA']),
    canais: z.number().int().positive(),
    janela: z.number().int().positive(),
    frequenciaHz: z.number().positive(),
  }),
  classes: z.array(z.string()),
  arquitetura: z.enum(['DENSA', 'CNN1D', 'DS_CNN']),
  camadas: z.number().int().min(1).max(6),
  neuronios: z.number().int().min(4).max(256),
  epocas: z.number().int().min(1).max(500),
  taxaAprendizado: z.number().positive(),
  quantizacao: z.enum(['INT8', 'FLOAT32']),
  placaAlvo: z.enum(PLACAS),
  limiteRamKb: z.number().positive(),
  limiteFlashKb: z.number().positive(),
  datasetId: z.number().int().positive().nullable(),
  ultimoTreinoId: z.number().int().positive().nullable(),
});

type ConfigTinyml = z.infer<typeof configSchema>;

const CONFIG_PADRAO = {
  tarefa: 'CLASSIFICACAO',
  entrada: { tipo: 'SERIE_TEMPORAL', canais: 3, janela: 50, frequenciaHz: 50 },
  classes: [],
  arquitetura: 'DENSA',
  camadas: 2,
  neuronios: 32,
  epocas: 30,
  taxaAprendizado: 0.001,
  quantizacao: 'INT8',
  placaAlvo: 'ESP32',
  limiteRamKb: 64,
  limiteFlashKb: 256,
  datasetId: null,
  ultimoTreinoId: null,
};

const treinarSchema = z.object({
  datasetId: z.number().int().positive(),
  parametros: configSchema.partial().optional(),
});

const callbackSchema = z.object({
  status: z.enum(['EXECUTANDO', 'SUCESSO', 'FALHA']),
  log: z.string().optional(),
  metricas: z.record(z.string(), z.unknown()).optional(),
  modeloTflite: z.string().optional(),
  modeloH: z.string().optional(),
  tamanhoBytes: z.number().int().nonnegative().optional(),
});

const camposResumo = {
  id: true,
  agenteId: true,
  datasetId: true,
  status: true,
  metricas: true,
  tamanhoBytes: true,
  criadoEm: true,
  finalizadoEm: true,
} as const;

// Envia o pedido ao trainer. Devolve false se o trainer não responder ou recusar.
async function enviarAoTrainer(treinoId: number, caminhoArquivo: string, cfg: ConfigTinyml): Promise<boolean> {
  const corpo = {
    treinoId,
    csv: caminhoDados(caminhoArquivo),
    saidaDir: caminhoDados('treinos', String(treinoId)),
    config: cfg,
    callbackUrl: `${config.serverUrlInterno}/api/interno/treinos/${treinoId}`,
    callbackToken: config.internoToken,
  };
  try {
    const resposta = await fetch(`${config.trainerUrl}/treinos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10_000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

async function buscarTreino(id: number) {
  const treino = await prisma.treino.findUnique({ where: { id } });
  if (!treino) throw new ErroHttp(404, 'Treino não encontrado');
  return treino;
}

async function enviarArquivoDoTreino(
  res: Response,
  next: NextFunction,
  relativo: string | null,
  nome: string,
): Promise<void> {
  if (!relativo) throw new ErroHttp(404, 'Modelo não disponível');
  const caminho = caminhoDados(relativo);
  await access(caminho).catch(() => {
    throw new ErroHttp(404, 'Modelo não disponível');
  });
  res.download(caminho, nome, (erro) => {
    if (erro && !res.headersSent) next(erro);
  });
}

// POST /agentes/:id/treinar — cria o Treino (FILA), envia ao trainer e marca EXECUTANDO
router.post('/agentes/:id/treinar', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const agenteId = idParam(req);
  const { datasetId, parametros } = treinarSchema.parse(req.body);

  const agente = await prisma.agente.findUnique({ where: { id: agenteId } });
  if (!agente) throw new ErroHttp(404, 'Agente não encontrado');
  if (agente.tipo !== 'TINYML') throw new ErroHttp(400, 'Só agentes TinyML podem ser treinados');

  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset) throw new ErroHttp(404, 'Dataset não encontrado');

  const base = (agente.configTinyml ?? CONFIG_PADRAO) as Record<string, unknown>;
  const cfg = configSchema.parse({ ...base, ...parametros, datasetId });

  const treino = await prisma.treino.create({
    data: { agenteId, datasetId, status: 'FILA', parametros: cfg as Prisma.InputJsonObject },
  });

  const aceito = await enviarAoTrainer(treino.id, dataset.caminhoArquivo, cfg);
  if (aceito) {
    // updateMany só muda se ainda estiver na FILA: o callback EXECUTANDO do trainer pode ter chegado antes.
    await prisma.treino.updateMany({
      where: { id: treino.id, status: 'FILA' },
      data: { status: 'EXECUTANDO', iniciadoEm: new Date() },
    });
  } else {
    await prisma.treino.update({
      where: { id: treino.id },
      data: { status: 'FALHA', log: 'Serviço de treino indisponível', finalizadoEm: new Date() },
    });
  }

  const atual = await prisma.treino.findUnique({ where: { id: treino.id } });
  res.status(201).json(atual);
}));

// GET /treinos?agenteId=
router.get('/treinos', autenticar, rota(async (req, res) => {
  const { agenteId } = z
    .object({ agenteId: z.coerce.number().int().positive().optional() })
    .parse(req.query);
  const lista = await prisma.treino.findMany({
    where: agenteId ? { agenteId } : undefined,
    select: camposResumo,
    orderBy: { criadoEm: 'desc' },
  });
  res.json(lista);
}));

// GET /treinos/:id
router.get('/treinos/:id', autenticar, rota(async (req, res) => {
  res.json(await buscarTreino(idParam(req)));
}));

// GET /treinos/:id/modelo.tflite
router.get('/treinos/:id/modelo.tflite', autenticar, rota(async (req, res, next) => {
  const treino = await buscarTreino(idParam(req));
  await enviarArquivoDoTreino(res, next, treino.modeloTflite, `modelo-${treino.id}.tflite`);
}));

// GET /treinos/:id/model_data.h
router.get('/treinos/:id/model_data.h', autenticar, rota(async (req, res, next) => {
  const treino = await buscarTreino(idParam(req));
  await enviarArquivoDoTreino(res, next, treino.modeloH, `model_data-${treino.id}.h`);
}));

// POST /interno/treinos/:id — callback do trainer (X-Interno-Token)
router.post('/interno/treinos/:id', exigirInterno, rota(async (req, res) => {
  const id = idParam(req);
  const corpo = callbackSchema.parse(req.body);
  const treino = await buscarTreino(id);

  const dados: Prisma.TreinoUpdateInput = { status: corpo.status };
  if (corpo.log) dados.log = treino.log ? `${treino.log}\n${corpo.log}` : corpo.log;
  if (corpo.metricas !== undefined) dados.metricas = corpo.metricas as Prisma.InputJsonObject;
  if (corpo.modeloTflite !== undefined) dados.modeloTflite = corpo.modeloTflite;
  if (corpo.modeloH !== undefined) dados.modeloH = corpo.modeloH;
  if (corpo.tamanhoBytes !== undefined) dados.tamanhoBytes = corpo.tamanhoBytes;
  if (corpo.status === 'EXECUTANDO' && !treino.iniciadoEm) dados.iniciadoEm = new Date();
  if (corpo.status === 'SUCESSO' || corpo.status === 'FALHA') dados.finalizadoEm = new Date();

  await prisma.treino.update({ where: { id }, data: dados });

  if (corpo.status === 'SUCESSO') {
    const agente = await prisma.agente.findUnique({ where: { id: treino.agenteId } });
    if (agente) {
      const base = (agente.configTinyml ?? {}) as Record<string, unknown>;
      await prisma.agente.update({
        where: { id: agente.id },
        data: { configTinyml: { ...base, ultimoTreinoId: id } as Prisma.InputJsonObject },
      });
    }
  }

  res.status(204).end();
}));

export default router;
