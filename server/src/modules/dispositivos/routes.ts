import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { PLACAS_PROJETO } from '../projetos/modelos';
import { gerarChaveDispositivo, paraDispositivosFrota } from '../frota/comum';
import type { ChaveGerada, TelemetriaPlaca } from '../frota/comum';
import { invalidarChaveDispositivo, publicarComando } from '../frota/mqtt';

const router = Router();

const ESCRITA = exigirPerfil('ADMIN', 'DEV');

const DispositivoEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do dispositivo').max(120),
  placa: z.enum(PLACAS_PROJETO),
  porta: z.string().max(200).optional(),
  notas: z.string().max(2000).optional(),
  projetoId: z.number().int().positive().nullable().optional(),
});

const DispositivoAtualizarEsquema = DispositivoEsquema.partial();

const AlvoEsquema = z.object({
  buildId: z.number().int().positive().nullable(),
});

const ComandoEsquema = z.object({
  acao: z.enum(['atualizar', 'reiniciar']),
});

// Garante que o projeto informado existe (400 se não).
async function validarProjeto(projetoId: number | null | undefined): Promise<void> {
  if (projetoId === null || projetoId === undefined) {
    return;
  }
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { id: true } });
  if (!projeto) {
    throw new ErroHttp(400, 'Projeto não encontrado');
  }
}

async function existente(id: number) {
  const dispositivo = await prisma.dispositivo.findUnique({ where: { id } });
  if (!dispositivo) {
    throw new ErroHttp(404, 'Dispositivo não encontrado');
  }
  return dispositivo;
}

async function umDispositivoFrota(id: number) {
  const dispositivo = await existente(id);
  const [saida] = await paraDispositivosFrota([dispositivo]);
  return saida;
}

router.get(
  '/dispositivos',
  autenticar,
  rota(async (_req, res) => {
    const lista = await prisma.dispositivo.findMany({ orderBy: { criadoEm: 'desc' } });
    res.json(await paraDispositivosFrota(lista));
  })
);

router.get(
  '/dispositivos/:id',
  autenticar,
  rota(async (req, res) => {
    res.json(await umDispositivoFrota(idParam(req)));
  })
);

router.post(
  '/dispositivos',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const corpo = DispositivoEsquema.parse(req.body);
    await validarProjeto(corpo.projetoId);
    const dispositivo = await prisma.dispositivo.create({
      data: {
        nome: corpo.nome,
        placa: corpo.placa,
        porta: corpo.porta ?? '',
        notas: corpo.notas ?? '',
        projetoId: corpo.projetoId ?? null,
      },
    });
    const [saida] = await paraDispositivosFrota([dispositivo]);
    res.status(201).json(saida);
  })
);

router.put(
  '/dispositivos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    await existente(id);
    const corpo = DispositivoAtualizarEsquema.parse(req.body);
    await validarProjeto(corpo.projetoId);
    await prisma.dispositivo.update({
      where: { id },
      data: {
        nome: corpo.nome,
        placa: corpo.placa,
        porta: corpo.porta,
        notas: corpo.notas,
        projetoId: corpo.projetoId,
      },
    });
    res.json(await umDispositivoFrota(id));
  })
);

router.delete(
  '/dispositivos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    await existente(id);
    await prisma.dispositivo.delete({ where: { id } });
    invalidarChaveDispositivo(id);
    res.status(204).end();
  })
);

// Gera uma chave nova (a anterior deixa de valer). A chave em claro aparece só nesta resposta.
router.post(
  '/dispositivos/:id/chave',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    await existente(id);
    const gerada = gerarChaveDispositivo();
    await prisma.dispositivo.update({
      where: { id },
      data: { chaveHash: gerada.hash, chavePrefixo: gerada.prefixo },
    });
    invalidarChaveDispositivo(id);
    const corpo: ChaveGerada = { chave: gerada.chave, prefixo: gerada.prefixo };
    res.json(corpo);
  })
);

// Define a build que deve ser instalada por OTA (null = nada a fazer).
router.put(
  '/dispositivos/:id/alvo',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    const dispositivo = await existente(id);
    const corpo = AlvoEsquema.parse(req.body);
    if (corpo.buildId !== null) {
      const build = await prisma.build.findUnique({ where: { id: corpo.buildId } });
      if (!build) {
        throw new ErroHttp(404, 'Compilação não encontrada');
      }
      if (build.status !== 'SUCESSO' || !build.artefatoOta) {
        throw new ErroHttp(400, 'A compilação precisa estar concluída e ter firmware OTA');
      }
      if (build.placa !== dispositivo.placa) {
        throw new ErroHttp(400, 'A compilação é de outra placa');
      }
    }
    await prisma.dispositivo.update({ where: { id }, data: { buildAlvoId: corpo.buildId } });
    res.json(await umDispositivoFrota(id));
  })
);

// Envia um comando pelo MQTT. 503 se o broker estiver fora.
router.post(
  '/dispositivos/:id/comando',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const id = idParam(req);
    await existente(id);
    const corpo = ComandoEsquema.parse(req.body);
    if (!publicarComando(id, corpo.acao)) {
      throw new ErroHttp(503, 'Broker MQTT indisponível');
    }
    res.status(202).json({ ok: true });
  })
);

// Telemetria recente (ordem crescente, no máximo 2000 pontos).
router.get(
  '/dispositivos/:id/telemetria',
  autenticar,
  rota(async (req, res) => {
    const id = idParam(req);
    await existente(id);
    const bruto = req.query.horas;
    const horasInformadas = typeof bruto === 'string' && /^\d+$/.test(bruto) ? Number(bruto) : 24;
    const horas = Math.min(Math.max(horasInformadas, 1), 168);
    const amostras = await prisma.telemetriaDispositivo.findMany({
      where: { dispositivoId: id, criadoEm: { gte: new Date(Date.now() - horas * 3600 * 1000) } },
      orderBy: { criadoEm: 'desc' },
      take: 2000,
      select: { criadoEm: true, dados: true },
    });
    res.json(
      amostras.reverse().map((a) => ({
        em: a.criadoEm.toISOString(),
        dados: a.dados as TelemetriaPlaca,
      }))
    );
  })
);

export default router;
