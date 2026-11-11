import { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil, UsuarioReq } from '../../lib/auth';
import { registrar } from '../../lib/log';

const router = Router();

const perfis = z.enum(['ADMIN', 'DEV', 'LEITOR'], { message: 'Perfil inválido' });
const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido');
const senhaSchema = z.string().min(6, 'A senha deve ter pelo menos 6 caracteres');

const esquemaCriar = z.object({
  nome: z.string().trim().min(1, 'Informe o nome'),
  email: emailSchema,
  senha: senhaSchema,
  perfil: perfis,
});

const esquemaAlterar = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').optional(),
  email: emailSchema.optional(),
  senha: senhaSchema.optional(),
  perfil: perfis.optional(),
  ativo: z.boolean().optional(),
});

const CAMPOS = { id: true, nome: true, email: true, perfil: true, ativo: true, criadoEm: true } as const;

function usuarioDaRota(req: Request): UsuarioReq {
  if (!req.usuario) {
    throw new ErroHttp(401, 'Não autenticado');
  }
  return req.usuario;
}

// Somente ADMIN gerencia usuários.
router.get(
  '/usuarios',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (_req, res) => {
    const usuarios = await prisma.usuario.findMany({ select: CAMPOS, orderBy: { nome: 'asc' } });
    res.json(usuarios);
  })
);

router.post(
  '/usuarios',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    const dados = esquemaCriar.parse(req.body);
    const existe = await prisma.usuario.findUnique({ where: { email: dados.email } });
    if (existe) {
      throw new ErroHttp(409, 'Já existe usuário com este e-mail');
    }
    const criado = await prisma.usuario.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        senhaHash: await bcrypt.hash(dados.senha, 10),
        perfil: dados.perfil,
      },
      select: CAMPOS,
    });
    await registrar(usuarioDaRota(req).id, 'Criou usuário', `${criado.nome} <${criado.email}> (${criado.perfil})`);
    res.status(201).json(criado);
  })
);

router.put(
  '/usuarios/:id',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    const id = idParam(req);
    const dados = esquemaAlterar.parse(req.body);
    const atual = await prisma.usuario.findUnique({ where: { id } });
    if (!atual) {
      throw new ErroHttp(404, 'Usuário não encontrado');
    }
    if (dados.email && dados.email !== atual.email) {
      const outro = await prisma.usuario.findUnique({ where: { email: dados.email } });
      if (outro) {
        throw new ErroHttp(409, 'Já existe usuário com este e-mail');
      }
    }
    const atualizado = await prisma.usuario.update({
      where: { id },
      data: {
        nome: dados.nome,
        email: dados.email,
        perfil: dados.perfil,
        ativo: dados.ativo,
        senhaHash: dados.senha ? await bcrypt.hash(dados.senha, 10) : undefined,
      },
      select: CAMPOS,
    });
    await registrar(usuarioDaRota(req).id, 'Alterou usuário', `${atualizado.nome} <${atualizado.email}> (${atualizado.perfil})`);
    res.json(atualizado);
  })
);

router.delete(
  '/usuarios/:id',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    const id = idParam(req);
    const quem = usuarioDaRota(req);
    if (id === quem.id) {
      throw new ErroHttp(400, 'Você não pode excluir a própria conta');
    }
    const alvo = await prisma.usuario.findUnique({ where: { id } });
    if (!alvo) {
      throw new ErroHttp(404, 'Usuário não encontrado');
    }
    await prisma.usuario.delete({ where: { id } });
    await registrar(quem.id, 'Excluiu usuário', `${alvo.nome} <${alvo.email}>`);
    res.status(204).end();
  })
);

export default router;
