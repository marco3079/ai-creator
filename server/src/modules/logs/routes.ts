import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';

const router = Router();

// Os 200 registros mais recentes (somente ADMIN).
router.get(
  '/logs',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (_req, res) => {
    const logs = await prisma.log.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 200,
      select: {
        id: true,
        acao: true,
        detalhe: true,
        criadoEm: true,
        usuario: { select: { id: true, nome: true } },
      },
    });
    res.json(logs);
  })
);

export default router;
