import { readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';
import { gerarSlug } from '../../lib/slug';
import { analisarCsv, interpretarCsv } from './csv';
import {
  caminhoSeguro,
  ehImagem,
  listarImagens,
  salvarConversas,
  salvarImagensZip,
  validarConversas,
} from './arquivos';

const router = Router();

const novoDatasetSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do dataset'),
  descricao: z.string().optional(),
  tipo: z.enum(['SERIE_TEMPORAL', 'AUDIO', 'TABELA']),
  janela: z.number().int().min(0).optional(),
  csv: z.string().min(1, 'CSV vazio'),
});

const novoArquivoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do dataset'),
  tipo: z.enum(['IMAGENS', 'CONVERSAS'], { message: 'Tipo deve ser IMAGENS ou CONVERSAS' }),
  descricao: z.string().optional(),
});

const campos = {
  id: true,
  nome: true,
  descricao: true,
  tipo: true,
  classes: true,
  janela: true,
  amostras: true,
  colunas: true,
  criadoEm: true,
} as const;

async function buscarDataset(id: number) {
  const dataset = await prisma.dataset.findUnique({ where: { id } });
  if (!dataset) throw new ErroHttp(404, 'Dataset não encontrado');
  return dataset;
}

// Remove o arquivo/pasta do dataset. Nunca com caminho vazio (apagaria DATA_DIR inteiro).
async function removerArquivos(caminhoArquivo: string): Promise<void> {
  if (!caminhoArquivo || !caminhoSeguro(caminhoArquivo.replace(/\/$/, ''))) return;
  await rm(caminhoDados(caminhoArquivo), { recursive: true, force: true });
}

// GET /datasets
router.get('/datasets', autenticar, rota(async (_req, res) => {
  const lista = await prisma.dataset.findMany({ select: campos, orderBy: { criadoEm: 'desc' } });
  res.json(lista);
}));

// POST /datasets — valida o CSV, grava o registro e salva o arquivo em /data/datasets/<id>.csv
router.post('/datasets', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const dados = novoDatasetSchema.parse(req.body);
  const resumo = analisarCsv(dados.csv);

  const criado = await prisma.dataset.create({
    data: {
      nome: dados.nome,
      descricao: dados.descricao ?? '',
      tipo: dados.tipo,
      janela: dados.janela ?? 0,
      classes: resumo.classes,
      amostras: resumo.amostras,
      colunas: resumo.colunas,
      caminhoArquivo: '',
    },
  });

  try {
    const caminhoArquivo = `datasets/${criado.id}.csv`;
    await writeFile(caminhoDados(caminhoArquivo), dados.csv, 'utf8');
    const dataset = await prisma.dataset.update({
      where: { id: criado.id },
      data: { caminhoArquivo },
      select: campos,
    });
    res.status(201).json(dataset);
  } catch (erro) {
    await prisma.dataset.delete({ where: { id: criado.id } }).catch(() => undefined);
    throw erro;
  }
}));

// POST /datasets/arquivo?nome=&tipo=IMAGENS|CONVERSAS&descricao= — corpo binário (zip ou jsonl).
// express.raw só nesta rota; o corpo chega como Buffer.
router.post(
  '/datasets/arquivo',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  express.raw({ type: '*/*', limit: '200mb' }),
  rota(async (req, res) => {
    const dados = novoArquivoSchema.parse(req.query);
    const corpo = req.body;
    if (!Buffer.isBuffer(corpo) || corpo.length === 0) {
      throw new ErroHttp(400, 'Envie o arquivo no corpo da requisição');
    }

    if (dados.tipo === 'CONVERSAS') {
      const validado = validarConversas(corpo.toString('utf8'));
      const criado = await prisma.dataset.create({
        data: {
          nome: dados.nome,
          descricao: dados.descricao ?? '',
          tipo: 'CONVERSAS',
          classes: [],
          janela: 0,
          amostras: validado.amostras,
          colunas: 0,
          caminhoArquivo: '',
        },
      });
      try {
        const caminhoArquivo = await salvarConversas(criado.id, validado.texto);
        const dataset = await prisma.dataset.update({
          where: { id: criado.id },
          data: { caminhoArquivo },
          select: campos,
        });
        res.status(201).json(dataset);
      } catch (erro) {
        await prisma.dataset.delete({ where: { id: criado.id } }).catch(() => undefined);
        throw erro;
      }
      return;
    }

    // IMAGENS: o zip é validado e extraído para /data/datasets/<id>/
    const criado = await prisma.dataset.create({
      data: {
        nome: dados.nome,
        descricao: dados.descricao ?? '',
        tipo: 'IMAGENS',
        classes: [],
        janela: 0,
        amostras: 0,
        colunas: 0,
        caminhoArquivo: '',
      },
    });
    try {
      const resumo = await salvarImagensZip(criado.id, corpo);
      const dataset = await prisma.dataset.update({
        where: { id: criado.id },
        data: {
          caminhoArquivo: `datasets/${criado.id}/`,
          classes: resumo.classes,
          amostras: resumo.amostras,
        },
        select: campos,
      });
      res.status(201).json(dataset);
    } catch (erro) {
      await prisma.dataset.delete({ where: { id: criado.id } }).catch(() => undefined);
      await removerArquivos(`datasets/${criado.id}/`);
      throw erro;
    }
  })
);

// DELETE /datasets/:id — apaga o registro, o CSV/JSONL ou a pasta de imagens
router.delete('/datasets/:id', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const dataset = await buscarDataset(idParam(req));
  await prisma.dataset.delete({ where: { id: dataset.id } });
  await removerArquivos(dataset.caminhoArquivo);
  res.status(204).end();
}));

// GET /datasets/:id/amostra — TABELA: cabeçalho e 20 linhas; IMAGENS: classes com exemplos;
// CONVERSAS: 5 primeiras conversas.
router.get('/datasets/:id/amostra', autenticar, rota(async (req, res) => {
  const dataset = await buscarDataset(idParam(req));

  if (dataset.tipo === 'IMAGENS') {
    const classes = await listarImagens(caminhoDados(dataset.caminhoArquivo));
    res.json({ formato: 'IMAGENS', classes });
    return;
  }

  if (dataset.tipo === 'CONVERSAS') {
    const texto = await readFile(caminhoDados(dataset.caminhoArquivo), 'utf8');
    const conversas = texto
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .slice(0, 5)
      .map((l) => JSON.parse(l) as { messages: { role: string; content: string }[] });
    res.json({ formato: 'CONVERSAS', conversas });
    return;
  }

  const texto = await readFile(caminhoDados(dataset.caminhoArquivo), 'utf8');
  const linhas = interpretarCsv(texto);
  const [cabecalho, ...dados] = linhas;
  res.json({
    formato: 'TABELA',
    cabecalho: cabecalho?.campos ?? [],
    linhas: dados.slice(0, 20).map((l) => l.campos),
  });
}));

// GET /datasets/:id/imagem?caminho=classe/arquivo.jpg — imagem de um dataset de IMAGENS
router.get('/datasets/:id/imagem', autenticar, rota(async (req, res) => {
  const dataset = await buscarDataset(idParam(req));
  if (dataset.tipo !== 'IMAGENS') throw new ErroHttp(400, 'Este dataset não tem imagens');

  const caminho = typeof req.query.caminho === 'string' ? req.query.caminho : '';
  if (!caminhoSeguro(caminho) || !ehImagem(caminho)) {
    throw new ErroHttp(400, 'Caminho de imagem inválido');
  }
  const pasta = path.resolve(caminhoDados(dataset.caminhoArquivo));
  const absoluto = path.resolve(pasta, caminho);
  if (!absoluto.startsWith(pasta + path.sep)) {
    throw new ErroHttp(400, 'Caminho de imagem inválido');
  }
  await access(absoluto).catch(() => {
    throw new ErroHttp(404, 'Imagem não encontrada');
  });
  res.sendFile(absoluto);
}));

// GET /datasets/:id/csv — download do arquivo CSV (rota existente)
router.get('/datasets/:id/csv', autenticar, rota(async (req, res, next) => {
  const dataset = await buscarDataset(idParam(req));
  const caminho = caminhoDados(dataset.caminhoArquivo);
  await access(caminho).catch(() => {
    throw new ErroHttp(404, 'Arquivo do dataset não encontrado');
  });
  const nome = `${gerarSlug(dataset.nome) || 'dataset'}.csv`;
  res.download(caminho, nome, (erro) => {
    if (erro && !res.headersSent) next(erro);
  });
}));

// GET /datasets/:id/arquivo — arquivo original (JSONL de conversas ou CSV). IMAGENS: 400.
router.get('/datasets/:id/arquivo', autenticar, rota(async (req, res, next) => {
  const dataset = await buscarDataset(idParam(req));
  if (dataset.tipo === 'IMAGENS') {
    throw new ErroHttp(400, 'Baixe as imagens pela pasta do volume');
  }
  const caminho = caminhoDados(dataset.caminhoArquivo);
  await access(caminho).catch(() => {
    throw new ErroHttp(404, 'Arquivo do dataset não encontrado');
  });
  const extensao = path.extname(dataset.caminhoArquivo) || '.csv';
  const nome = `${gerarSlug(dataset.nome) || 'dataset'}${extensao}`;
  res.download(caminho, nome, (erro) => {
    if (erro && !res.headersSent) next(erro);
  });
}));

export default router;
