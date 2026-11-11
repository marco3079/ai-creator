import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirInterno, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';

const router = Router();

const ESCRITA = exigirPerfil('ADMIN', 'DEV');

const GravarEsquema = z.object({
  porta: z.string().trim().min(1, 'Informe a porta'),
});

const StatusEsquema = z.enum(['FILA', 'EXECUTANDO', 'SUCESSO', 'FALHA', 'CANCELADO']);

const CallbackBuildEsquema = z.object({
  status: StatusEsquema,
  log: z.string().optional(),
  artefato: z.string().optional(),
  offset: z.string().optional(),
  tamanhoBytes: z.number().int().nonnegative().optional(),
});

// Lista de compilações; ?projetoId= filtra por projeto.
router.get(
  '/builds',
  autenticar,
  rota(async (req, res) => {
    const bruto = req.query.projetoId;
    const projetoId = typeof bruto === 'string' && /^\d+$/.test(bruto) ? Number(bruto) : undefined;
    const builds = await prisma.build.findMany({
      where: projetoId ? { projetoId } : {},
      orderBy: { criadoEm: 'desc' },
      select: {
        id: true,
        projetoId: true,
        placa: true,
        status: true,
        tamanhoBytes: true,
        offset: true,
        criadoEm: true,
        finalizadoEm: true,
      },
    });
    res.json(builds);
  })
);

// Detalhe da compilação, com o log completo.
router.get(
  '/builds/:id',
  autenticar,
  rota(async (req, res) => {
    const build = await prisma.build.findUnique({ where: { id: idParam(req) } });
    if (!build) {
      throw new ErroHttp(404, 'Compilação não encontrada');
    }
    res.json(build);
  })
);

// Download do firmware gerado pelo builder.
router.get(
  '/builds/:id/firmware',
  autenticar,
  rota(async (req, res) => {
    const build = await prisma.build.findUnique({ where: { id: idParam(req) } });
    if (!build || !build.artefato || build.status !== 'SUCESSO') {
      throw new ErroHttp(404, 'Firmware indisponível');
    }
    const caminho = caminhoDados(build.artefato);
    if (!fs.existsSync(caminho)) {
      throw new ErroHttp(404, 'Arquivo do firmware não encontrado');
    }
    res.download(caminho, caminho.split(/[\\/]/).pop() ?? 'firmware.bin');
  })
);

// Grava o firmware na placa pela porta USB. Repassa ao builder e atualiza o dispositivo com essa porta.
router.post(
  '/builds/:id/gravar',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const build = await prisma.build.findUnique({ where: { id: idParam(req) } });
    if (!build) {
      throw new ErroHttp(404, 'Compilação não encontrada');
    }
    if (!build.artefato || build.status !== 'SUCESSO') {
      throw new ErroHttp(400, 'A compilação não gerou firmware');
    }
    const corpo = GravarEsquema.parse(req.body);

    let resultado: { ok: boolean; log: string } = { ok: false, log: 'Serviço de compilação indisponível' };
    try {
      const resposta = await fetch(`${config.builderUrl}/gravar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artefato: `/data/${build.artefato}`,
          placa: build.placa,
          porta: corpo.porta,
          offset: build.offset ?? undefined,
        }),
        signal: AbortSignal.timeout(600000),
      });
      const dados = (await resposta.json()) as { ok?: boolean; log?: string };
      resultado = { ok: dados.ok === true, log: dados.log ?? '' };
    } catch {
      // Mantém o resultado de falha padrão acima.
    }

    if (resultado.ok) {
      await prisma.dispositivo.updateMany({
        where: { porta: corpo.porta },
        data: { ultimoBuildId: build.id, ultimaGravacao: new Date() },
      });
    }
    res.json(resultado);
  })
);

// Callback do builder (sem JWT): atualiza status, acrescenta log e registra o artefato.
router.post(
  '/interno/builds/:id',
  exigirInterno,
  rota(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.build.findUnique({ where: { id } });
    if (!atual) {
      throw new ErroHttp(404, 'Compilação não encontrada');
    }
    const corpo = CallbackBuildEsquema.parse(req.body);
    const finaliza = corpo.status === 'SUCESSO' || corpo.status === 'FALHA' || corpo.status === 'CANCELADO';
    await prisma.build.update({
      where: { id },
      data: {
        status: corpo.status,
        log: corpo.log !== undefined ? atual.log + corpo.log : undefined,
        artefato: corpo.artefato,
        offset: corpo.offset,
        tamanhoBytes: corpo.tamanhoBytes,
        finalizadoEm: finaliza ? new Date() : undefined,
      },
    });
    res.status(204).end();
  })
);

export default router;
