import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';
import { gerarSlug, slugUnico } from '../../lib/slug';
import { registrar } from '../../lib/log';
import { ConfigTinyml } from '../agentes/padroes';
import { validarCaminho } from './caminhos';
import { Placa, PLACAS_PROJETO, arquivosModelo, iniPara } from './modelos';

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

// Artefato de um treino da área Modelos (CONTRATOS-MODELOS §1).
interface ArtefatoTreino {
  nome: string;
  tipo: string;
  caminho: string;
  tamanhoBytes: number;
}

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

// Grava os arquivos do banco em /data/projetos/<slug>, preservando a pasta .pio (cache do PlatformIO).
function escreverProjetoEmDisco(projeto: { slug: string; arquivos: { caminho: string; conteudo: string }[] }): string {
  const pasta = caminhoDados('projetos', projeto.slug);
  fs.mkdirSync(pasta, { recursive: true });
  for (const item of fs.readdirSync(pasta)) {
    if (item === '.pio') {
      continue;
    }
    fs.rmSync(path.join(pasta, item), { recursive: true, force: true });
  }
  for (const arquivo of projeto.arquivos) {
    const relativo = validarCaminho(arquivo.caminho);
    const destino = path.join(pasta, relativo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, arquivo.conteudo, 'utf8');
  }
  return pasta;
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
    const slug = await gerarSlugProjeto(corpo.nome);
    const projeto = await prisma.projeto.create({
      data: {
        nome: corpo.nome,
        slug,
        descricao: corpo.descricao ?? '',
        placa: corpo.placa,
        arquivos: { create: arquivosModelo(corpo.placa, corpo.nome) },
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
    const projeto = await prisma.projeto.update({
      where: { id: projetoAtual.id },
      data: {
        nome: corpo.nome,
        descricao: corpo.descricao,
        placa: corpo.placa,
      },
    });
    if (corpo.placa && corpo.placa !== projetoAtual.placa) {
      await prisma.arquivoProjeto.upsert({
        where: { projetoId_caminho: { projetoId: projeto.id, caminho: 'platformio.ini' } },
        update: { conteudo: iniPara(corpo.placa as Placa) },
        create: { projetoId: projeto.id, caminho: 'platformio.ini', conteudo: iniPara(corpo.placa as Placa) },
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

// Compila o projeto: grava os arquivos em disco, embute o modelo do agente (se houver) e chama o builder.
router.post(
  '/projetos/:id/build',
  autenticar,
  ESCRITA,
  rota(async (req: Request, res: Response) => {
    const projetoAtual = await buscarProjeto(req);
    const corpo = BuildEsquema.parse(req.body ?? {});

    const projeto = await prisma.projeto.findUnique({
      where: { id: projetoAtual.id },
      include: { arquivos: { select: { caminho: true, conteudo: true } } },
    });
    if (!projeto) {
      throw new ErroHttp(404, 'Projeto não encontrado');
    }

    // Modelo TinyML do último treino do agente, se informado.
    let origemModelo: string | null = null;
    if (corpo.agenteId) {
      const agente = await prisma.agente.findUnique({ where: { id: corpo.agenteId } });
      if (!agente) {
        throw new ErroHttp(404, 'Agente não encontrado');
      }
      const cfgTinyml = (agente.configTinyml as unknown as ConfigTinyml | null) ?? null;
      const ultimoTreinoId = cfgTinyml?.ultimoTreinoId ?? null;
      if (ultimoTreinoId) {
        const treino = await prisma.treino.findUnique({ where: { id: ultimoTreinoId } });
        if (treino?.modeloH) {
          origemModelo = path.join(config.dataDir, treino.modeloH);
          if (!fs.existsSync(origemModelo)) {
            throw new ErroHttp(400, 'O modelo do último treino do agente não foi encontrado');
          }
        }
      }
    }

    // Treino da área Modelos: seus artefatos HEADER_C vão para include/. Valida antes de gravar nada.
    const headersTreino: { origem: string; nome: string }[] = [];
    if (corpo.modeloTreinoId) {
      const treino = await prisma.treinoModelo.findUnique({
        where: { id: corpo.modeloTreinoId },
        include: { modelo: { select: { tipo: true } } },
      });
      const tipoOk = treino?.modelo.tipo === 'TINYML' || treino?.modelo.tipo === 'TABULAR';
      if (!treino || treino.status !== 'SUCESSO' || !tipoOk) {
        throw new ErroHttp(400, 'Escolha um treino concluído com sucesso de um modelo TinyML ou Tabular');
      }
      const artefatos = (treino.artefatos as unknown as ArtefatoTreino[] | null) ?? [];
      for (const artefato of artefatos.filter((a) => a.tipo === 'HEADER_C')) {
        const origem = path.join(config.dataDir, artefato.caminho);
        if (!fs.existsSync(origem)) {
          throw new ErroHttp(400, `O artefato ${artefato.nome} do treino não foi encontrado`);
        }
        headersTreino.push({ origem, nome: path.basename(artefato.nome) });
      }
    }

    // Grava os arquivos antes de criar o Build, para não deixar registro órfão se a gravação falhar.
    const pasta = escreverProjetoEmDisco(projeto);
    if (origemModelo) {
      const destinoModelo = path.join(pasta, 'include', 'model_data.h');
      fs.mkdirSync(path.dirname(destinoModelo), { recursive: true });
      fs.copyFileSync(origemModelo, destinoModelo);
    }
    for (const header of headersTreino) {
      const destino = path.join(pasta, 'include', header.nome);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(header.origem, destino);
    }

    const build = await prisma.build.create({
      data: {
        projetoId: projeto.id,
        placa: projeto.placa,
        agenteId: corpo.agenteId ?? null,
        modeloTreinoId: corpo.modeloTreinoId ?? null,
        status: 'FILA',
      },
    });

    await prisma.build.update({ where: { id: build.id }, data: { status: 'EXECUTANDO' } });

    let indisponivel = false;
    try {
      const resposta = await fetch(`${config.builderUrl}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildId: build.id,
          projetoDir: `/data/projetos/${projeto.slug}`,
          placa: projeto.placa,
          saidaDir: `/data/builds/${build.id}`,
          callbackUrl: `${config.serverUrlInterno}/api/interno/builds/${build.id}`,
          callbackToken: config.internoToken,
        }),
        signal: AbortSignal.timeout(15000),
      });
      indisponivel = !resposta.ok;
    } catch {
      indisponivel = true;
    }

    const atualizado = indisponivel
      ? await prisma.build.update({
          where: { id: build.id },
          data: { status: 'FALHA', log: 'Serviço de compilação indisponível', finalizadoEm: new Date() },
        })
      : await prisma.build.findUnique({ where: { id: build.id } });

    await registrar(req.usuario?.id ?? null, 'build.criar', `${projeto.nome} (#${build.id})`);
    res.status(202).json(atualizado);
  })
);

export default router;
