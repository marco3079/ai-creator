import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';

const router = Router();

const CAMPOS = { nome: true, slogan: true, corPrimaria: true } as const;

const esquemaAlterar = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da plataforma').max(80).optional(),
  slogan: z.string().trim().max(200, 'Slogan longo demais').optional(),
  corPrimaria: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #rrggbb)').optional(),
});

// Registro único (id = 1), criado sob demanda com os padrões do schema.
function plataformaAtual() {
  return prisma.plataforma.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: CAMPOS });
}

// Rota pública: usada pela tela de login.
router.get(
  '/plataforma',
  rota(async (_req, res) => {
    res.json(await plataformaAtual());
  })
);

router.put(
  '/plataforma',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    const dados = esquemaAlterar.parse(req.body);
    const atualizada = await prisma.plataforma.upsert({
      where: { id: 1 },
      update: dados,
      create: { id: 1, ...dados },
      select: CAMPOS,
    });
    await registrar(req.usuario?.id ?? null, 'Alterou a plataforma', atualizada.nome);
    res.json(atualizada);
  })
);

// Rota pública de saúde do servidor.
router.get(
  '/saude',
  rota(async (_req, res) => {
    res.json({ ok: true });
  })
);

export default router;
