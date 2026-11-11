import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { PLACAS_PROJETO } from '../projetos/modelos';

const router = Router();

const ESCRITA = exigirPerfil('ADMIN', 'DEV');

const DispositivoEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do dispositivo').max(120),
  placa: z.enum(PLACAS_PROJETO),
  porta: z.string().max(200).optional(),
  notas: z.string().max(2000).optional(),
});

const DispositivoAtualizarEsquema = DispositivoEsquema.partial();

router.get(
  '/dispositivos',
  autenticar,
  rota(async (_req, res) => {
    res.json(await prisma.dispositivo.findMany({ orderBy: { criadoEm: 'desc' } }));
  })
);

router.post(
  '/dispositivos',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const corpo = DispositivoEsquema.parse(req.body);
    const dispositivo = await prisma.dispositivo.create({
      data: {
        nome: corpo.nome,
        placa: corpo.placa,
        porta: corpo.porta ?? '',
        notas: corpo.notas ?? '',
      },
    });
    res.status(201).json(dispositivo);
  })
);

router.put(
  '/dispositivos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    const existe = await prisma.dispositivo.findUnique({ where: { id } });
    if (!existe) {
      throw new ErroHttp(404, 'Dispositivo não encontrado');
    }
    const corpo = DispositivoAtualizarEsquema.parse(req.body);
    const dispositivo = await prisma.dispositivo.update({
      where: { id },
      data: {
        nome: corpo.nome,
        placa: corpo.placa,
        porta: corpo.porta,
        notas: corpo.notas,
      },
    });
    res.json(dispositivo);
  })
);

router.delete(
  '/dispositivos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    const existe = await prisma.dispositivo.findUnique({ where: { id } });
    if (!existe) {
      throw new ErroHttp(404, 'Dispositivo não encontrado');
    }
    await prisma.dispositivo.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
