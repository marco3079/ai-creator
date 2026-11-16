import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { gerarSlug, slugUnico } from '../../lib/slug';
import { registrar } from '../../lib/log';
import { validarCaminho } from './caminhos';
import { Placa, PLACAS_PROJETO, arquivosModelo, ehProjetoOta, iniPara, modeloSuportado } from './modelos';
import { criarBuild } from './build';

const router = Router();

const ESCRITA = exigirPerfil('ADMIN', 'DEV');

const PlacaEsquema = z.enum(PLACAS_PROJETO);

const ProjetoEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do projeto').max(120),
  descricao: z.string().max(2000).optional(),
  placa: PlacaEsquema,
});

const ProjetoAtualizarEsquema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().max(2000).optional(),
  placa: PlacaEsquema.optional(),
});

const ArquivosLoteEsquema = z.object({
  arquivos: z.array(z.object({ caminho: z.string(), conteudo: z.string() })),
  removerAusentes: z.boolean().optional(),
});

const ArquivoEsquema = z.object({
  caminho: z.string(),
  conteudo: z.string(),
});

const BuildEsquema = z.object({
  agenteId: z.number().int().positive().optional(),
  modeloTreinoId: z.number().int().positive().optional(),
});

// Modelo de firmware do projeto novo (OTA só para placas com Wi-Fi).
const ModeloFirmwareEsquema = z.enum(['BLINK', 'COLETOR', 'OTA']).optional();

// Aceita id numérico ou slug na URL.
function filtroProjeto(ref: string): Prisma.ProjetoWhereInput {
  return /^\d+$/.test(ref) ? { id: Number(ref) } : { slug: ref };
}

async function buscarProjeto(req: Request) {
  const ref = req.params.id;
  const projeto = await prisma.projeto.findFirst({
    where: filtroProjeto(ref),
    include: {
      arquivos: { select: { caminho: true, atualizadoEm: true }, orderBy: { caminho: 'asc' } },
    },
  });
  if (!projeto) {
    throw new ErroHttp(404, 'Projeto não encontrado');
  }
  return projeto;
}

function caminhoQuery(req: Request): string {
  const bruto = req.query.caminho;
  if (typeof bruto !== 'string') {
    throw new ErroHttp(400, 'Informe o parâmetro caminho');
  }
  return validarCaminho(bruto);
}

async function gerarSlugProjeto(nome: string): Promise<string> {
  return slugUnico(gerarSlug(nome), async (s) => {
    return (await prisma.projeto.findUnique({ where: { slug: s } })) !== null;
  });
}

// Lista de projetos (mais recentes primeiro).
router.get(
  '/projetos',
  autenticar,
  rota(async (_req, res) => {
    const projetos = await prisma.projeto.findMany({
      orderBy: { atualizadoEm: 'desc' },
      include: {
        _count: { select: { arquivos: true } },
        builds: { orderBy: { criadoEm: 'desc' }, take: 1, select: { id: true, status: true, criadoEm: true } },
      },
    });
    res.json(
      projetos.map((p) => ({
        id: p.id,
        nome: p.nome,
        slug: p.slug,
        descricao: p.descricao,
        placa: p.placa,
        framework: p.framework,
        atualizadoEm: p.atualizadoEm,
        totalArquivos: p._count.arquivos,
        ultimoBuild: p.builds[0] ?? null,
      }))
    );
  })
);

// Cria o projeto com os arquivos-modelo da placa.
router.post(
  '/projetos',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const corpo = ProjetoEsquema.parse(req.body);
    const modelo = ModeloFirmwareEsquema.parse((req.body as { modelo?: unknown })?.modelo) ?? 'BLINK';
    if (!modeloSuportado(corpo.placa, modelo)) {
      throw new ErroHttp(400, 'OTA só para ESP32 e ESP32-S3');
    }
    const slug = await gerarSlugProjeto(corpo.nome);
    const projeto = await prisma.projeto.create({
      data: {
        nome: corpo.nome,
        slug,
        descricao: corpo.descricao ?? '',
        placa: corpo.placa,
        arquivos: { create: arquivosModelo(corpo.placa, corpo.nome, modelo) },
      },
      include: {
        arquivos: { select: { caminho: true, atualizadoEm: true }, orderBy: { caminho: 'asc' } },
      },
    });
    await registrar(req.usuario?.id ?? null, 'projeto.criar', projeto.nome);
    res.status(201).json(projeto);
  })
);

// Detalhe do projeto com a lista de arquivos (id ou slug).
router.get(
  '/projetos/:id',
  autenticar,
  rota(async (req, res) => {
    res.json(await buscarProjeto(req));
  })
);

// Atualiza nome, descrição e placa. Trocar a placa reescreve só o platformio.ini.
router.put(
  '/projetos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projetoAtual = await buscarProjeto(req);
    const corpo = ProjetoAtualizarEsquema.parse(req.body);
    // Troca de placa: se o projeto é OTA, a nova placa precisa de Wi-Fi e o ini mantém lib_deps e partições.
    // A checagem roda antes do update para não gravar nada quando recusar.
    let iniNovo: string | undefined;
    if (corpo.placa && corpo.placa !== projetoAtual.placa) {
      const iniAtual = await prisma.arquivoProjeto.findUnique({
        where: { projetoId_caminho: { projetoId: projetoAtual.id, caminho: 'platformio.ini' } },
      });
      const ota = iniAtual !== null && ehProjetoOta(iniAtual.conteudo);
      if (ota && !modeloSuportado(corpo.placa as Placa, 'OTA')) {
        throw new ErroHttp(400, 'OTA só para ESP32 e ESP32-S3');
      }
      iniNovo = iniPara(corpo.placa as Placa, ota ? 'OTA' : 'BLINK');
    }
    const projeto = await prisma.projeto.update({
      where: { id: projetoAtual.id },
      data: {
        nome: corpo.nome,
        descricao: corpo.descricao,
        placa: corpo.placa,
      },
    });
    if (iniNovo !== undefined) {
      await prisma.arquivoProjeto.upsert({
        where: { projetoId_caminho: { projetoId: projeto.id, caminho: 'platformio.ini' } },
        update: { conteudo: iniNovo },
        create: { projetoId: projeto.id, caminho: 'platformio.ini', conteudo: iniNovo },
      });
    }
    res.json(
      await prisma.projeto.findUnique({
        where: { id: projeto.id },
        include: {
          arquivos: { select: { caminho: true, atualizadoEm: true }, orderBy: { caminho: 'asc' } },
        },
      })
    );
  })
);

router.delete(
  '/projetos/:id',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    await prisma.projeto.delete({ where: { id: projeto.id } });
    await registrar(req.usuario?.id ?? null, 'projeto.excluir', projeto.nome);
    res.status(204).end();
  })
);

// Lista de arquivos; ?conteudo=1 inclui o texto de cada um.
router.get(
  '/projetos/:id/arquivos',
  autenticar,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const comConteudo = req.query.conteudo === '1';
    const arquivos = await prisma.arquivoProjeto.findMany({
      where: { projetoId: projeto.id },
      orderBy: { caminho: 'asc' },
    });
    res.json(
      arquivos.map((a) => ({
        caminho: a.caminho,
        atualizadoEm: a.atualizadoEm,
        ...(comConteudo ? { conteudo: a.conteudo } : {}),
      }))
    );
  })
);

// Upsert em lote. removerAusentes apaga os arquivos que não vieram na lista.
router.put(
  '/projetos/:id/arquivos',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const corpo = ArquivosLoteEsquema.parse(req.body);
    const itens = corpo.arquivos.map((a) => ({ caminho: validarCaminho(a.caminho), conteudo: a.conteudo }));
    const operacoes: Prisma.PrismaPromise<unknown>[] = itens.map((a) =>
      prisma.arquivoProjeto.upsert({
        where: { projetoId_caminho: { projetoId: projeto.id, caminho: a.caminho } },
        update: { conteudo: a.conteudo },
        create: { projetoId: projeto.id, caminho: a.caminho, conteudo: a.conteudo },
      })
    );
    if (corpo.removerAusentes) {
      operacoes.push(
        prisma.arquivoProjeto.deleteMany({
          where: { projetoId: projeto.id, caminho: { notIn: itens.map((a) => a.caminho) } },
        })
      );
    }
    await prisma.$transaction(operacoes);
    res.status(204).end();
  })
);

router.get(
  '/projetos/:id/arquivo',
  autenticar,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const caminho = caminhoQuery(req);
    const arquivo = await prisma.arquivoProjeto.findUnique({
      where: { projetoId_caminho: { projetoId: projeto.id, caminho } },
    });
    if (!arquivo) {
      throw new ErroHttp(404, 'Arquivo não encontrado');
    }
    res.json({ caminho: arquivo.caminho, conteudo: arquivo.conteudo });
  })
);

router.put(
  '/projetos/:id/arquivo',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const corpo = ArquivoEsquema.parse(req.body);
    const caminho = validarCaminho(corpo.caminho);
    await prisma.arquivoProjeto.upsert({
      where: { projetoId_caminho: { projetoId: projeto.id, caminho } },
      update: { conteudo: corpo.conteudo },
      create: { projetoId: projeto.id, caminho, conteudo: corpo.conteudo },
    });
    res.status(204).end();
  })
);

router.delete(
  '/projetos/:id/arquivo',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const caminho = caminhoQuery(req);
    const removidos = await prisma.arquivoProjeto.deleteMany({
      where: { projetoId: projeto.id, caminho },
    });
    if (removidos.count === 0) {
      throw new ErroHttp(404, 'Arquivo não encontrado');
    }
    res.status(204).end();
  })
);

// Compila o projeto: valida o pedido e enfileira o Build (FILA). A fila envia ao builder.
router.post(
  '/projetos/:id/build',
  autenticar,
  ESCRITA,
  rota(async (req: Request, res) => {
    const projetoAtual = await buscarProjeto(req);
    const corpo = BuildEsquema.parse(req.body ?? {});
    const build = await criarBuild(
      projetoAtual.id,
      { agenteId: corpo.agenteId, modeloTreinoId: corpo.modeloTreinoId },
      req.usuario?.id ?? null,
    );
    res.status(202).json(build);
  })
);

export default router;
