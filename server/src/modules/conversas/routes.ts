import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { MensagensEsquema } from '../agentes/esquemas';

const router = express.Router();

const CriarConversaEsquema = z.object({
  titulo: z.string().trim().min(1, 'Informe o título da conversa').max(200),
  mensagens: MensagensEsquema,
});

const AtualizarConversaEsquema = z.object({ mensagens: MensagensEsquema });

const json = (valor: unknown) => valor as Prisma.InputJsonValue;

async function buscarConversa(id: string) {
  const numero = Number(id);
  const conversa = Number.isInteger(numero)
    ? await prisma.conversa.findUnique({ where: { id: numero } })
    : null;
  if (!conversa) throw new ErroHttp(404, 'Conversa não encontrada');
  return conversa;
}

router.get(
  '/agentes/:id/conversas',
  autenticar,
  rota(async (req, res) => {
    const agente = await prisma.agente.findUnique({
      where: /^\d+$/.test(req.params.id) ? { id: Number(req.params.id) } : { slug: req.params.id },
      select: { id: true },
    });
    if (!agente) throw new ErroHttp(404, 'Agente não encontrado');
    const conversas = await prisma.conversa.findMany({
      where: { agenteId: agente.id },
      orderBy: { atualizadoEm: 'desc' },
      select: { id: true, titulo: true, atualizadoEm: true },
    });
    res.json(conversas);
  }),
);

router.post(
  '/agentes/:id/conversas',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const dados = CriarConversaEsquema.parse(req.body);
    const agente = await prisma.agente.findUnique({
      where: /^\d+$/.test(req.params.id) ? { id: Number(req.params.id) } : { slug: req.params.id },
      select: { id: true, slug: true },
    });
    if (!agente) throw new ErroHttp(404, 'Agente não encontrado');
    const conversa = await prisma.conversa.create({
      data: {
        agenteId: agente.id,
        usuarioId: req.usuario!.id,
        titulo: dados.titulo,
        mensagens: json(dados.mensagens),
      },
    });
    await registrar(req.usuario!.id, 'Criou conversa', `${agente.slug}: ${dados.titulo}`);
    res.status(201).json(conversa);
  }),
);

router.get(
  '/conversas/:id',
  autenticar,
  rota(async (req, res) => {
    const conversa = await buscarConversa(req.params.id);
    res.json({ id: conversa.id, titulo: conversa.titulo, mensagens: conversa.mensagens });
  }),
);

router.put(
  '/conversas/:id',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const dados = AtualizarConversaEsquema.parse(req.body);
    const atual = await buscarConversa(req.params.id);
    const conversa = await prisma.conversa.update({
      where: { id: atual.id },
      data: { mensagens: json(dados.mensagens) },
    });
    res.json(conversa);
  }),
);

router.delete(
  '/conversas/:id',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const atual = await buscarConversa(req.params.id);
    await prisma.conversa.delete({ where: { id: atual.id } });
    await registrar(req.usuario!.id, 'Excluiu conversa', atual.titulo);
    res.status(204).end();
  }),
);

export default router;
