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
import { executarAnthropicComFerramentas } from './provedores/anthropic-ferramentas';
import { MODELOS_OPENAI } from './provedores/openai';
import { executarOpenaiComFerramentas } from './provedores/openai-ferramentas';
import { listarModelosOllama, ollamaRespondeu } from './provedores/ollama';
import type { UsoComFerramentas } from './provedores/ferramentas-tipos';
import { criarExecutorFerramentas, ferramentasDoAgente } from './ferramentas';
import { registrarUso } from '../uso/registrar';

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
    // Ferramentas da plataforma: só com projeto vinculado e "aic.*" marcados no agente.
    const ferramentas = ferramentasDoAgente({
      ferramentas: (agente.ferramentas as string[] | null) ?? [],
      projetoId: agente.projetoId,
    });
    const comFerramentas = ferramentas.length > 0;
    const ollamaSemFerramentas = comFerramentas && provedor === 'OLLAMA';

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
      if (ollamaSemFerramentas) {
        enviar({
          tipo: 'texto',
          texto: 'Aviso: o Ollama não usa as ferramentas da plataforma; a resposta segue sem elas.\n\n',
        });
      }
      const configuracao = {
        modelo: agente.modelo ?? '',
        promptSistema: agente.promptSistema ?? '',
        esforco: agente.esforco,
        temperatura: agente.temperatura,
        maxTokens: agente.maxTokens,
      };
      const aoTexto = (texto: string) => enviar({ tipo: 'texto', texto });

      let uso: { entrada: number; saida: number; ferramentas: number };
      if (comFerramentas && provedor !== 'OLLAMA') {
        const executorComFerramentas =
          provedor === 'ANTHROPIC' ? executarAnthropicComFerramentas : executarOpenaiComFerramentas;
        const comFerr: UsoComFerramentas = await executorComFerramentas(
          configuracao,
          mensagens,
          ferramentas,
          criarExecutorFerramentas(agente.projetoId!, req.usuario!.id),
          aoTexto,
          (evento) => enviar(evento),
          controle.signal,
        );
        uso = comFerr;
      } else {
        const semFerr = await executor(configuracao, mensagens, aoTexto, controle.signal);
        uso = { ...semFerr, ferramentas: 0 };
      }

      const { custoUsd } = await registrarUso({
        agenteId: agente.id,
        usuarioId: req.usuario!.id,
        provedor,
        modelo: agente.modelo ?? '',
        entrada: uso.entrada,
        saida: uso.saida,
        ferramentas: uso.ferramentas,
      });
      enviar({ tipo: 'fim', uso: { entrada: uso.entrada, saida: uso.saida, custoUsd } });
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
