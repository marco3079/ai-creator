import fs from 'node:fs';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { caminhoDados } from '../../lib/arquivos';
import { iniciarAjusteOpenai } from './openai';

const TIMEOUT_MS = 10_000;

const MSG_TRAINER = 'Serviço de treino indisponível';
const MSG_FINETUNER = 'Serviço finetuner indisponível. Suba com: docker compose --profile gpu up -d finetuner';
const MSG_OPENAI = 'OPENAI_API_KEY não configurada no servidor (.env).';

// Marca FALHA acrescentando a mensagem ao log. Não sobrescreve treino já cancelado.
async function marcarFalha(id: number, mensagem: string): Promise<void> {
  const atual = await prisma.treinoModelo.findUnique({ where: { id }, select: { log: true } });
  const log = atual?.log ? `${atual.log}\n${mensagem}` : mensagem;
  await prisma.treinoModelo.updateMany({
    where: { id, status: { not: 'CANCELADO' } },
    data: { status: 'FALHA', log, finalizadoEm: new Date() },
  });
}

// POST JSON com timeout. Devolve false se o serviço não responder ou recusar o pedido.
async function enviar(url: string, corpo: unknown): Promise<boolean> {
  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

// Pasta de saída do treino: /data/modelos/<modeloId>/treinos/<numero>
function pastaSaida(modeloId: number, numero: number): string {
  const pasta = caminhoDados('modelos', String(modeloId), 'treinos', String(numero));
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

// Envia o treino ao serviço certo conforme o tipo do modelo (CONTRATOS-MODELOS §4 e §5/§6).
// Marca EXECUTANDO antes do envio; falhas viram FALHA com o log. Nunca lança.
export async function despacharTreino(treinoId: number): Promise<void> {
  const treino = await prisma.treinoModelo.findUnique({
    where: { id: treinoId },
    include: { modelo: true, dataset: true },
  });
  if (!treino || treino.status !== 'FILA') return;

  await prisma.treinoModelo.update({
    where: { id: treinoId },
    data: { status: 'EXECUTANDO', iniciadoEm: new Date() },
  });

  const { modelo, dataset } = treino;
  const parametros = (treino.parametros ?? {}) as Record<string, unknown>;

  try {
    if (modelo.tipo === 'LLM_NUVEM') {
      if (!config.openaiChave) {
        await marcarFalha(treinoId, MSG_OPENAI);
        return;
      }
      await iniciarAjusteOpenai(treinoId);
      return;
    }

    if (!dataset) {
      await marcarFalha(treinoId, 'Dataset não encontrado');
      return;
    }

    const callbackUrl = `${config.serverUrlInterno}/api/interno/treinos-modelo/${treinoId}`;
    const saidaDir = pastaSaida(modelo.id, treino.numero);

    if (modelo.tipo === 'TINYML' || modelo.tipo === 'TABULAR') {
      const aceito = await enviar(`${config.trainerUrl}/modelos/treinos`, {
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
      });
      if (!aceito) await marcarFalha(treinoId, MSG_TRAINER);
      return;
    }

    if (modelo.tipo === 'LLM_LOCAL') {
      const nomeInformado = typeof parametros.nomeOllama === 'string' ? parametros.nomeOllama.trim() : '';
      const aceito = await enviar(`${config.finetunerUrl}/treinos`, {
        treinoId,
        dataset: caminhoDados(dataset.caminhoArquivo),
        saidaDir,
        config: parametros,
        nomeOllama: nomeInformado || `aic-${modelo.slug}-v${treino.numero}`,
        ollamaUrl: config.ollamaUrl,
        callbackUrl,
        callbackToken: config.internoToken,
      });
      if (!aceito) await marcarFalha(treinoId, MSG_FINETUNER);
      return;
    }

    await marcarFalha(treinoId, `Tipo de modelo sem treino: ${modelo.tipo}`);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await marcarFalha(treinoId, mensagem);
  }
}
