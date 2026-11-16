import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { ouvirEventos } from '../../lib/eventos';
import { validarCaminho } from '../projetos/caminhos';
import {
  ArquivoVersao,
  arquivosDaVersao,
  criarVersao,
  nomesDosAutores,
} from './comum';
import { gerarZipGit, VersaoParaGit } from './git';

const router = Router();

const ESCRITA = exigirPerfil('ADMIN', 'DEV');

const SalvarVersaoEsquema = z.object({
  mensagem: z
    .string({ error: 'Mensagem inválida' })
    .trim()
    .min(1, 'Informe a mensagem da versão')
    .max(200, 'A mensagem pode ter até 200 caracteres'),
});

// Aceita id numérico ou slug na URL (igual ao módulo de projetos).
function filtroProjeto(ref: string): Prisma.ProjetoWhereInput {
  return /^\d+$/.test(ref) ? { id: Number(ref) } : { slug: ref };
}

async function buscarProjeto(req: Request): Promise<{ id: number; nome: string; slug: string }> {
  const projeto = await prisma.projeto.findFirst({
    where: filtroProjeto(req.params.id),
    select: { id: true, nome: true, slug: true },
  });
  if (!projeto) {
    throw new ErroHttp(404, 'Projeto não encontrado');
  }
  return projeto;
}

async function buscarVersao(projetoId: number, numero: number) {
  const versao = await prisma.versaoProjeto.findUnique({
    where: { projetoId_numero: { projetoId, numero } },
  });
  if (!versao) {
    throw new ErroHttp(404, 'Versão não encontrada');
  }
  return versao;
}

// Versão automática criada pelo listener de builds (sem autor, sem erro para o build).
async function criarVersaoAutomatica(projetoId: number, buildId: number): Promise<void> {
  await criarVersao(projetoId, {
    mensagem: `Compilação #${buildId}`,
    autorId: null,
    buildId,
  });
}

// Versões automáticas: ao criar um build (evento FILA), guarda uma versão do projeto.
// Registrado uma única vez por carregamento do módulo. Erros não derrubam o servidor.
let ouvindoBuilds = false;
function iniciarVersaoAutomatica(): void {
  if (ouvindoBuilds) return;
  ouvindoBuilds = true;
  ouvirEventos((evento) => {
    if (evento.tipo !== 'build' || evento.status !== 'FILA' || evento.projetoId == null) return;
    criarVersaoAutomatica(evento.projetoId, evento.id).catch((erro: unknown) => {
      console.error(
        'Falha ao criar versão automática do build:',
        erro instanceof Error ? erro.message : String(erro)
      );
    });
  });
}
iniciarVersaoAutomatica();

// Lista (mais recente primeiro), sem o conteúdo dos arquivos.
router.get(
  '/projetos/:id/versoes',
  autenticar,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const versoes = await prisma.versaoProjeto.findMany({
      where: { projetoId: projeto.id },
      orderBy: { numero: 'desc' },
      select: { numero: true, mensagem: true, autorId: true, buildId: true, criadoEm: true, arquivos: true },
    });
    const nomes = await nomesDosAutores(
      versoes.map((v) => v.autorId).filter((id): id is number => id !== null)
    );
    res.json(
      versoes.map((v) => ({
        numero: v.numero,
        mensagem: v.mensagem,
        autor: v.autorId !== null && nomes.has(v.autorId) ? { id: v.autorId, nome: nomes.get(v.autorId) } : null,
        buildId: v.buildId,
        criadoEm: v.criadoEm.toISOString(),
        totalArquivos: arquivosDaVersao(v.arquivos).length,
      }))
    );
  })
);

// Salva uma versão manual com o estado atual dos arquivos. 409 se nada mudou.
router.post(
  '/projetos/:id/versoes',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const { mensagem } = SalvarVersaoEsquema.parse(req.body);
    const resultado = await criarVersao(projeto.id, {
      mensagem,
      autorId: req.usuario?.id ?? null,
      buildId: null,
    });
    if (!resultado.criada) {
      throw new ErroHttp(409, `Nada mudou desde a v${resultado.numero}`);
    }
    const versao = await buscarVersao(projeto.id, resultado.numero);
    await registrar(req.usuario?.id ?? null, 'versao.salvar', `${projeto.nome} (v${resultado.numero})`);
    const nomes = await nomesDosAutores(versao.autorId !== null ? [versao.autorId] : []);
    res.status(201).json({
      numero: versao.numero,
      mensagem: versao.mensagem,
      autor: versao.autorId !== null && nomes.has(versao.autorId) ? { id: versao.autorId, nome: nomes.get(versao.autorId) } : null,
      buildId: versao.buildId,
      criadoEm: versao.criadoEm.toISOString(),
      totalArquivos: arquivosDaVersao(versao.arquivos).length,
    });
  })
);

// Uma versão com todos os arquivos.
router.get(
  '/projetos/:id/versoes/:numero',
  autenticar,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const versao = await buscarVersao(projeto.id, idParam(req, 'numero'));
    const arquivos = arquivosDaVersao(versao.arquivos);
    const nomes = await nomesDosAutores(versao.autorId !== null ? [versao.autorId] : []);
    res.json({
      numero: versao.numero,
      mensagem: versao.mensagem,
      autor: versao.autorId !== null && nomes.has(versao.autorId) ? { id: versao.autorId, nome: nomes.get(versao.autorId) } : null,
      buildId: versao.buildId,
      criadoEm: versao.criadoEm.toISOString(),
      totalArquivos: arquivos.length,
      arquivos,
    });
  })
);

// Restaura uma versão: antes cria a versão automática "Antes de restaurar a v<n>" (se houver mudança).
router.post(
  '/projetos/:id/versoes/:numero/restaurar',
  autenticar,
  ESCRITA,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const numero = idParam(req, 'numero');
    const versao = await buscarVersao(projeto.id, numero);

    const arquivos: ArquivoVersao[] = arquivosDaVersao(versao.arquivos).map((arquivo) => ({
      caminho: validarCaminho(arquivo.caminho),
      conteudo: arquivo.conteudo,
    }));

    await criarVersao(projeto.id, {
      mensagem: `Antes de restaurar a v${numero}`,
      autorId: req.usuario?.id ?? null,
      buildId: null,
    });

    await prisma.$transaction([
      prisma.arquivoProjeto.deleteMany({ where: { projetoId: projeto.id } }),
      prisma.arquivoProjeto.createMany({
        data: arquivos.map((arquivo) => ({
          projetoId: projeto.id,
          caminho: arquivo.caminho,
          conteudo: arquivo.conteudo,
        })),
      }),
    ]);

    await registrar(req.usuario?.id ?? null, 'versao.restaurar', `${projeto.nome} (v${numero})`);
    res.json({ restaurada: numero, totalArquivos: arquivos.length });
  })
);

// Repositório Git com um commit por versão, em .zip.
router.get(
  '/projetos/:id/git.zip',
  autenticar,
  rota(async (req, res) => {
    const projeto = await buscarProjeto(req);
    const versoes = await prisma.versaoProjeto.findMany({
      where: { projetoId: projeto.id },
      orderBy: { numero: 'asc' },
      select: { numero: true, mensagem: true, autorId: true, criadoEm: true, arquivos: true },
    });
    if (versoes.length === 0) {
      throw new ErroHttp(409, 'Salve pelo menos uma versão antes de baixar o repositório Git');
    }

    const nomes = await nomesDosAutores(
      versoes.map((v) => v.autorId).filter((id): id is number => id !== null)
    );
    const paraGit: VersaoParaGit[] = versoes.map((v) => ({
      numero: v.numero,
      mensagem: v.mensagem,
      autorNome: v.autorId !== null ? nomes.get(v.autorId) ?? null : null,
      criadoEm: v.criadoEm,
      arquivos: arquivosDaVersao(v.arquivos),
    }));

    const zip = await gerarZipGit(paraGit);
    await registrar(req.usuario?.id ?? null, 'versao.git', projeto.nome);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projeto.slug}-git.zip"`);
    res.send(zip);
  })
);

export default router;
