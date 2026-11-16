import fs from 'node:fs';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { caminhoDados } from '../../lib/arquivos';
import { enviarPedido, type ResultadoEnvio } from '../fila/servicos';
import { iniciarAjusteOpenai } from './openai';

const TIMEOUT_MS = 10_000;

const MSG_OPENAI = 'OPENAI_API_KEY não configurada no servidor (.env).';

// Marca FALHA acrescentando a mensagem ao log. Não sobrescreve treino já cancelado.
export async function marcarFalha(id: number, mensagem: string): Promise<void> {
  const atual = await prisma.treinoModelo.findUnique({ where: { id }, select: { log: true } });
  const log = atual?.log ? `${atual.log}\n${mensagem}` : mensagem;
  await prisma.treinoModelo.updateMany({
    where: { id, status: { not: 'CANCELADO' } },
    data: { status: 'FALHA', log, finalizadoEm: new Date() },
  });
}

// Pasta de saída do treino: /data/modelos/<modeloId>/treinos/<numero>
function pastaSaida(modeloId: number, numero: number): string {
  const pasta = caminhoDados('modelos', String(modeloId), 'treinos', String(numero));
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

// Envia o treino ao serviço certo conforme o tipo do modelo (CONTRATOS-MODELOS §4 e §5/§6).
// Chamado pelo despachante da fila, com o treino já em EXECUTANDO. Não muda o status:
// devolve 'ok', 'indisponivel' (a fila tenta de novo) ou {erro} (a fila marca FALHA). Nunca lança.
export async function enviarTreinoModelo(treinoId: number): Promise<ResultadoEnvio> {
  try {
    const treino = await prisma.treinoModelo.findUnique({
      where: { id: treinoId },
      include: { modelo: true, dataset: true },
    });
    if (!treino) return { erro: 'Treino não encontrado' };

    const { modelo, dataset } = treino;
    const parametros = (treino.parametros ?? {}) as Record<string, unknown>;

    if (modelo.tipo === 'LLM_NUVEM') {
      if (!config.openaiChave) return { erro: MSG_OPENAI };
      // iniciarAjusteOpenai grava sozinho o status (EXECUTANDO ou FALHA) e o log.
      await iniciarAjusteOpenai(treinoId);
      return 'ok';
    }

    if (!dataset) return { erro: 'Dataset não encontrado' };

    const callbackUrl = `${config.serverUrlInterno}/api/interno/treinos-modelo/${treinoId}`;
    const saidaDir = pastaSaida(modelo.id, treino.numero);

    if (modelo.tipo === 'TINYML' || modelo.tipo === 'TABULAR') {
      return enviarPedido(
        `${config.trainerUrl}/modelos/treinos`,
        {
          treinoId,
          tipo: modelo.tipo,
          tarefa: modelo.tarefa,
          dataset: {
            tipo: dataset.tipo,
            caminho: caminhoDados(dataset.caminhoArquivo),
            classes: dataset.classes,
          },
          saidaDir,
          config: parametros,
          callbackUrl,
          callbackToken: config.internoToken,
        },
        TIMEOUT_MS,
      );
    }

    if (modelo.tipo === 'LLM_LOCAL') {
      const nomeInformado = typeof parametros.nomeOllama === 'string' ? parametros.nomeOllama.trim() : '';
      return enviarPedido(
        `${config.finetunerUrl}/treinos`,
        {
          treinoId,
          dataset: caminhoDados(dataset.caminhoArquivo),
          saidaDir,
          config: parametros,
          nomeOllama: nomeInformado || `aic-${modelo.slug}-v${treino.numero}`,
          ollamaUrl: config.ollamaUrl,
          callbackUrl,
          callbackToken: config.internoToken,
        },
        TIMEOUT_MS,
      );
    }

    return { erro: `Tipo de modelo sem treino: ${modelo.tipo}` };
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
