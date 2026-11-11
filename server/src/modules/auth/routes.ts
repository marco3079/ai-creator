import { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, rota } from '../../lib/erros';
import { assinarJwt, autenticar, UsuarioReq } from '../../lib/auth';
import { registrar } from '../../lib/log';

const router = Router();

const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Informe o e-mail'),
  senha: z.string().min(1, 'Informe a senha'),
});

function publicoDe(u: UsuarioReq): UsuarioReq {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil };
}

function usuarioDaRota(req: Request): UsuarioReq {
  if (!req.usuario) {
    throw new ErroHttp(401, 'Não autenticado');
  }
  return req.usuario;
}

// Rota pública: não usa JWT.
router.post(
  '/auth/login',
  rota(async (req, res) => {
    const { email, senha } = esquemaLogin.parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    const senhaConfere = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;

    if (!usuario || !usuario.ativo || !senhaConfere) {
      await registrar(usuario?.id ?? null, 'Tentativa de login recusada', email);
      throw new ErroHttp(401, 'E-mail ou senha inválidos');
    }

    const publico = publicoDe(usuario);
    await registrar(usuario.id, 'Login', usuario.email);
    res.json({ token: assinarJwt(publico), usuario: publico });
  })
);

router.post(
  '/auth/sair',
  autenticar,
  rota(async (_req, res) => {
    res.status(204).end();
  })
);

router.get(
  '/auth/eu',
  autenticar,
  rota(async (req, res) => {
    res.json({ usuario: publicoDe(usuarioDaRota(req)) });
  })
);

export default router;
