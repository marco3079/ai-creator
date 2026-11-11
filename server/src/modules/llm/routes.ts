import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config as configServidor } from '../../lib/config';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { MensagensEsquema } from '../agentes/esquemas';
import { executorDe } from './executar';
import { MODELOS_ANTHROPIC } from './provedores/anthropic';
import { MODELOS_OPENAI } from './provedores/openai';
import { listarModelosOllama, ollamaRespondeu } from './provedores/ollama';

const router = express.Router();

const ExecutarEsquema = z
  .object({ mensagens: MensagensEsquema })
  .refine((d) => d.mensagens[d.mensagens.length - 1].role === 'user', {
    message: 'A última mensagem deve ser do usuário',
    path: ['mensagens'],
  });

async function localizarAgente(idOuSlug: string) {
  const onde = /^\d+$/.test(idOuSlug) ? { id: Number(idOuSlug) } : { slug: idOuSlug };
  const agente = await prisma.agente.findUnique({ where: onde });
  if (!agente) throw new ErroHttp(404, 'Agente não encontrado');
  return agente;
}

router.get(
  '/llm/modelos',
  autenticar,
  rota(async (_req, res) => {
    res.json({
      ANTHROPIC: MODELOS_ANTHROPIC,
      OPENAI: MODELOS_OPENAI,
      OLLAMA: await listarModelosOllama(),
    });
  }),
);

router.get(
  '/llm/status',
  autenticar,
  rota(async (_req, res) => {
    res.json({
      ANTHROPIC: Boolean(process.env.ANTHROPIC_API_KEY),
      OPENAI: Boolean(configServidor.openaiChave),
      OLLAMA: await ollamaRespondeu(),
    });
  }),
);

// Execução em SSE. Erros de validação saem como JSON (antes do stream); falhas do provedor saem como evento.
router.post(
  '/agentes/:id/executar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const agente = await localizarAgente(req.params.id);
    if (agente.tipo !== 'LLM') throw new ErroHttp(400, 'Só agentes LLM podem ser executados');
    const { mensagens } = ExecutarEsquema.parse(req.body);

    const provedor = agente.provedor ?? 'ANTHROPIC';
    const executor = executorDe(provedor);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Aborta o provedor quando o cliente sai antes do fim da resposta.
    const controle = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controle.abort();
    });

    const enviar = (evento: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(evento)}\n\n`);
    };

    await registrar(req.usuario!.id, 'Executou agente', `${agente.slug} (${provedor})`);

    try {
      const uso = await executor(
        {
          modelo: agente.modelo ?? '',
          promptSistema: agente.promptSistema ?? '',
          esforco: agente.esforco,
          temperatura: agente.temperatura,
          maxTokens: agente.maxTokens,
        },
        mensagens,
        (texto) => enviar({ tipo: 'texto', texto }),
        controle.signal,
      );
      enviar({ tipo: 'fim', uso });
    } catch (e) {
      if (!controle.signal.aborted) {
        enviar({ tipo: 'erro', erro: e instanceof Error ? e.message : 'Falha inesperada ao executar o agente' });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }),
);

export default router;
