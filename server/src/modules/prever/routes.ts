import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar } from '../../lib/auth';
import type { Artefato } from '../modelos/padroes';

// Espelha ResultadoPrevisao de client/src/lib/tipos-melhorias.ts (o servidor não importa o cliente).
interface ResultadoPrevisao {
  classe?: string;
  probabilidades?: { classe: string; valor: number }[];
  valor?: number;
  saidaBruta: number[];
  latenciaMs: number;
  avisos: string[];
}

// Testar um treino publicado/concluído: repassa a entrada ao trainer (/modelos/prever), que roda o
// mesmo .tflite INT8 (ou o .joblib) que vai para a placa. Só TINYML e TABULAR, só treinos com SUCESSO.

const router = Router();

const LIMITE_IMAGEM_BYTES = 8 * 1024 * 1024;
const LIMITE_AUDIO_BYTES = 4 * 1024 * 1024;
const TEMPO_LIMITE_TRAINER_MS = 30_000;

// Chamada ao trainer. Falha de conexão ou timeout vira 503; erro 400 do trainer vira 400 com o detalhe.
async function chamarTrainer(corpo: unknown): Promise<ResultadoPrevisao> {
  let resposta: globalThis.Response;
  try {
    resposta = await fetch(`${config.trainerUrl}/modelos/prever`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_TRAINER_MS),
    });
  } catch {
    throw new ErroHttp(503, 'Serviço de treino indisponível');
  }

  if (resposta.status === 400) {
    const dados = (await resposta.json().catch(() => null)) as { detail?: unknown } | null;
    const detalhe = typeof dados?.detail === 'string' ? dados.detail : 'Entrada inválida';
    throw new ErroHttp(400, detalhe);
  }
  if (!resposta.ok) {
    throw new ErroHttp(503, 'Serviço de treino indisponível');
  }
  return (await resposta.json()) as ResultadoPrevisao;
}

const pedidoSchema = z
  .object({
    valores: z.array(z.number().finite()).min(1, 'Informe pelo menos um valor').max(10000, 'Valores demais (máximo 10000)').optional(),
    imagemBase64: z.string().min(1, 'Imagem vazia').optional(),
    audioBase64: z.string().min(1, 'Áudio vazio').optional(),
  })
  .refine(
    (d) => [d.valores, d.imagemBase64, d.audioBase64].filter((x) => x !== undefined).length === 1,
    { message: 'Envie exatamente um tipo de entrada: valores, imagemBase64 ou audioBase64' },
  );

// Tamanho real (bytes decodificados) do base64, para conferir os limites.
function bytesDoBase64(texto: string): number {
  const limpo = texto.replace(/\s/g, '');
  const preenchimento = limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0;
  return Math.floor((limpo.length * 3) / 4) - preenchimento;
}

// Converte os artefatos do treino em caminhos absolutos, todos dentro de DATA_DIR.
function caminhosArtefatos(artefatos: Artefato[], tipo: string): { tflite?: string; joblib?: string; metricas: string } {
  const dataDir = path.resolve(config.dataDir);
  const absoluto = (a: Artefato): string => {
    const abs = path.resolve(config.dataDir, a.caminho);
    if (!abs.startsWith(dataDir + path.sep)) throw new ErroHttp(400, 'Caminho de artefato inválido');
    return abs;
  };

  const metricas = artefatos.find((a) => a.tipo === 'METRICAS');
  if (!metricas) throw new ErroHttp(400, 'Este treino não tem o arquivo de métricas.');

  const saida: { tflite?: string; joblib?: string; metricas: string } = { metricas: absoluto(metricas) };
  const tflite = artefatos.find((a) => a.tipo === 'TFLITE');
  const joblib = artefatos.find((a) => a.tipo === 'JOBLIB');
  if (tipo === 'TINYML') {
    if (!tflite) throw new ErroHttp(400, 'Este treino não tem modelo TFLite.');
    saida.tflite = absoluto(tflite);
  } else {
    if (!joblib) throw new ErroHttp(400, 'Este treino não tem modelo joblib.');
    saida.joblib = absoluto(joblib);
  }
  return saida;
}

// POST /treinos-modelo/:id/prever — roda o modelo do treino com a entrada enviada (síncrono).
router.post(
  '/treinos-modelo/:id/prever',
  autenticar,
  rota(async (req, res) => {
    const id = idParam(req);
    const pedido = pedidoSchema.parse(req.body ?? {});

    if (pedido.imagemBase64 !== undefined && bytesDoBase64(pedido.imagemBase64) > LIMITE_IMAGEM_BYTES) {
      throw new ErroHttp(400, 'Imagem grande demais (máximo 8 MB).');
    }
    if (pedido.audioBase64 !== undefined && bytesDoBase64(pedido.audioBase64) > LIMITE_AUDIO_BYTES) {
      throw new ErroHttp(400, 'Áudio grande demais (máximo 4 MB).');
    }

    const treino = await prisma.treinoModelo.findUnique({ where: { id }, include: { modelo: true } });
    if (!treino) throw new ErroHttp(404, 'Treino não encontrado');

    const tipo = treino.modelo.tipo;
    if (tipo !== 'TINYML' && tipo !== 'TABULAR') {
      throw new ErroHttp(400, 'Só é possível testar modelos TinyML e tabulares.');
    }
    if (treino.status !== 'SUCESSO') {
      throw new ErroHttp(400, 'Só é possível testar um treino concluído com sucesso.');
    }

    const tarefa = treino.modelo.tarefa;
    if (tarefa === 'IMAGEM' && pedido.imagemBase64 === undefined) {
      throw new ErroHttp(400, 'Envie uma imagem para testar este modelo.');
    }
    if (tarefa === 'AUDIO' && pedido.audioBase64 === undefined) {
      throw new ErroHttp(400, 'Envie um arquivo .wav para testar este modelo.');
    }
    if ((tarefa === 'CLASSIFICACAO' || tarefa === 'REGRESSAO') && pedido.valores === undefined) {
      throw new ErroHttp(400, 'Envie os valores de uma linha de atributos.');
    }

    const artefatos = caminhosArtefatos((treino.artefatos ?? []) as unknown as Artefato[], tipo);

    const resultado = await chamarTrainer({
      tipo,
      tarefa,
      artefatos,
      config: treino.parametros ?? {},
      entrada: {
        valores: pedido.valores,
        imagemBase64: pedido.imagemBase64,
        audioBase64: pedido.audioBase64,
      },
    });
    res.json(resultado);
  }),
);

export default router;
