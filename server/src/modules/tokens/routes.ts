import { Request, Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil, UsuarioReq } from '../../lib/auth';
import { registrar } from '../../lib/log';

const router = Router();

const esquemaCriar = z.object({
  nome: z.string().trim().min(1, 'Informe um nome para o token').max(80, 'Nome longo demais'),
});

const CAMPOS = { id: true, nome: true, prefixo: true, criadoEm: true, ultimoUso: true, revogado: true } as const;

function usuarioDaRota(req: Request): UsuarioReq {
  if (!req.usuario) {
    throw new ErroHttp(401, 'Não autenticado');
  }
  return req.usuario;
}

// Lista só os tokens do usuário logado.
router.get(
  '/tokens',
  autenticar,
  rota(async (req, res) => {
    const tokens = await prisma.tokenApi.findMany({
      where: { usuarioId: usuarioDaRota(req).id },
      select: CAMPOS,
      orderBy: { criadoEm: 'desc' },
    });
    res.json(tokens);
  })
);

// O token em claro aparece só nesta resposta; no banco fica apenas o hash sha256.
router.post(
  '/tokens',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const { nome } = esquemaCriar.parse(req.body);
    const quem = usuarioDaRota(req);
    const token = 'aic_' + crypto.randomBytes(20).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const registro = await prisma.tokenApi.create({
      data: { usuarioId: quem.id, nome, prefixo: token.slice(0, 12), hash },
      select: CAMPOS,
    });
    await registrar(quem.id, 'Criou token de API', nome);
    res.status(201).json({ token, registro });
  })
);

router.delete(
  '/tokens/:id',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const id = idParam(req);
    const quem = usuarioDaRota(req);
    const registro = await prisma.tokenApi.findFirst({ where: { id, usuarioId: quem.id } });
    if (!registro) {
      throw new ErroHttp(404, 'Token não encontrado');
    }
    await prisma.tokenApi.update({ where: { id }, data: { revogado: true } });
    await registrar(quem.id, 'Revogou token de API', registro.nome);
    res.status(204).end();
  })
);

export default router;
