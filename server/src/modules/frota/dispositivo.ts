import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticarDispositivo, emitirDispositivo } from './comum';
import type { Placa } from '../projetos/modelos';

// HTTP usado pela placa (CONTRATOS-LEVA-B §3). Sem JWT de usuário: autenticação pelos cabeçalhos do dispositivo.
const router = Router();

interface ArtefatoOta {
  caminho: string; // absoluto
  tamanho: number;
  md5: string;
}

// md5 e tamanho por buildId, calculados uma vez.
const cacheArtefato = new Map<number, ArtefatoOta>();

// Build que a placa pode baixar: SUCESSO, mesma placa e com firmware OTA.
function buscarBuildOta(placa: Placa, buildId: number) {
  return prisma.build.findFirst({
    where: { id: buildId, placa, status: 'SUCESSO', artefatoOta: { not: null } },
  });
}

// Confere que o arquivo existe dentro de DATA_DIR e calcula md5 (com cache). Null se indisponível.
function artefatoDoBuild(build: { id: number; artefatoOta: string | null }): ArtefatoOta | null {
  if (!build.artefatoOta) {
    return null;
  }
  const raiz = path.resolve(config.dataDir);
  const caminho = path.resolve(raiz, build.artefatoOta);
  if (!caminho.startsWith(raiz + path.sep) || !fs.existsSync(caminho)) {
    return null;
  }
  const emCache = cacheArtefato.get(build.id);
  if (emCache && emCache.caminho === caminho) {
    return emCache;
  }
  const conteudo = fs.readFileSync(caminho);
  const info: ArtefatoOta = {
    caminho,
    tamanho: conteudo.length,
    md5: crypto.createHash('md5').update(conteudo).digest('hex'),
  };
  cacheArtefato.set(build.id, info);
  return info;
}

// A placa pergunta se há atualização. Só oferece o build alvo, se for diferente do que roda.
router.get(
  '/ota/verificar',
  rota(async (req, res) => {
    const dispositivo = await autenticarDispositivo(req);
    const bruto = req.query.versao;
    const versao = typeof bruto === 'string' && /^\d+$/.test(bruto) ? Number(bruto) : null;

    await prisma.dispositivo.update({ where: { id: dispositivo.id }, data: { ultimoContato: new Date() } });

    if (dispositivo.buildAlvoId === null || dispositivo.buildAlvoId === versao) {
      res.json({ atualizar: false });
      return;
    }
    const build = await buscarBuildOta(dispositivo.placa, dispositivo.buildAlvoId);
    const artefato = build ? artefatoDoBuild(build) : null;
    if (!build || !artefato) {
      res.json({ atualizar: false });
      return;
    }
    res.json({
      atualizar: true,
      buildId: build.id,
      url: `/api/ota/firmware/${build.id}`,
      tamanho: artefato.tamanho,
      md5: artefato.md5,
    });
  })
);

// Binário da aplicação (firmware-ota.bin), só se for o alvo do dispositivo. Cabeçalho x-MD5.
router.get(
  '/ota/firmware/:buildId',
  rota(async (req, res) => {
    const dispositivo = await autenticarDispositivo(req);
    const buildId = idParam(req, 'buildId');
    if (dispositivo.buildAlvoId !== buildId) {
      throw new ErroHttp(404, 'Firmware indisponível');
    }
    const build = await buscarBuildOta(dispositivo.placa, buildId);
    const artefato = build ? artefatoDoBuild(build) : null;
    if (!artefato) {
      throw new ErroHttp(404, 'Firmware indisponível');
    }
    res.setHeader('x-MD5', artefato.md5);
    res.type('application/octet-stream');
    res.sendFile(artefato.caminho, (erro) => {
      if (erro && !res.headersSent) {
        res.status(404).json({ erro: 'Firmware indisponível' });
      }
    });
  })
);

const ResultadoEsquema = z.object({
  buildId: z.number().int().positive(),
  ok: z.boolean(),
  mensagem: z.string().max(500).optional(),
});

// Resultado da tentativa de OTA. Com ok, o build passa a ser o atual da placa.
router.post(
  '/ota/resultado',
  rota(async (req, res) => {
    const dispositivo = await autenticarDispositivo(req);
    const corpo = ResultadoEsquema.parse(req.body);
    const agora = new Date();
    const dados: { statusOta: string; ultimaOta: Date; ultimoContato: Date; buildAtualId?: number } = {
      statusOta: corpo.ok ? 'ok' : `erro: ${corpo.mensagem ?? 'falha na atualização'}`,
      ultimaOta: agora,
      ultimoContato: agora,
    };
    if (corpo.ok) {
      const build = await prisma.build.findFirst({ where: { id: corpo.buildId, placa: dispositivo.placa } });
      if (build) {
        dados.buildAtualId = build.id;
      }
    }
    await prisma.dispositivo.update({ where: { id: dispositivo.id }, data: dados });
    await emitirDispositivo(dispositivo.id);
    res.status(204).end();
  })
);

export default router;
