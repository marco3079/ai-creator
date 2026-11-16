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

const esquemaTrocarSenha = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual'),
  novaSenha: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres'),
});

export interface UsuarioPublico extends UsuarioReq {
  trocarSenha: boolean;
}

function publicoDe(u: UsuarioReq & { trocarSenha: boolean }): UsuarioPublico {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, trocarSenha: u.trocarSenha };
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
    const quem = usuarioDaRota(req);
    const atual = await prisma.usuario.findUnique({ where: { id: quem.id } });
    if (!atual) {
      throw new ErroHttp(401, 'Não autenticado');
    }
    res.json({ usuario: publicoDe(atual) });
  })
);

// Troca de senha pelo próprio usuário. Devolve novo token e usuário com trocarSenha = false.
router.post(
  '/auth/trocar-senha',
  autenticar,
  rota(async (req, res) => {
    const { senhaAtual, novaSenha } = esquemaTrocarSenha.parse(req.body);
    const quem = usuarioDaRota(req);
    const atual = await prisma.usuario.findUnique({ where: { id: quem.id } });
    if (!atual) {
      throw new ErroHttp(401, 'Não autenticado');
    }
    if (!(await bcrypt.compare(senhaAtual, atual.senhaHash))) {
      throw new ErroHttp(400, 'A senha atual está incorreta');
    }
    if (novaSenha === senhaAtual) {
      throw new ErroHttp(400, 'A nova senha deve ser diferente da atual');
    }
    if (novaSenha.trim().toLowerCase() === atual.email.toLowerCase()) {
      throw new ErroHttp(400, 'A nova senha não pode ser igual ao e-mail');
    }
    const atualizado = await prisma.usuario.update({
      where: { id: atual.id },
      data: { senhaHash: await bcrypt.hash(novaSenha, 10), trocarSenha: false },
    });
    const publico = publicoDe(atualizado);
    await registrar(atualizado.id, 'Trocou a senha', atualizado.email);
    res.json({ token: assinarJwt(publico), usuario: publico });
  })
);

export default router;
