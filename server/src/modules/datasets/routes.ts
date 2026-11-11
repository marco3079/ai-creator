import { readFile, rm, writeFile, access } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';
import { gerarSlug } from '../../lib/slug';
import { analisarCsv, interpretarCsv } from './csv';

const router = Router();

const novoDatasetSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do dataset'),
  descricao: z.string().optional(),
  tipo: z.enum(['SERIE_TEMPORAL', 'AUDIO', 'TABELA']),
  janela: z.number().int().min(0).optional(),
  csv: z.string().min(1, 'CSV vazio'),
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

// DELETE /datasets/:id
router.delete('/datasets/:id', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const dataset = await buscarDataset(idParam(req));
  await prisma.dataset.delete({ where: { id: dataset.id } });
  await rm(caminhoDados(dataset.caminhoArquivo), { force: true });
  res.status(204).end();
}));

// GET /datasets/:id/amostra — cabeçalho e 20 primeiras linhas
router.get('/datasets/:id/amostra', autenticar, rota(async (req, res) => {
  const dataset = await buscarDataset(idParam(req));
  const texto = await readFile(caminhoDados(dataset.caminhoArquivo), 'utf8');
  const linhas = interpretarCsv(texto);
  const [cabecalho, ...dados] = linhas;
  res.json({
    cabecalho: cabecalho?.campos ?? [],
    linhas: dados.slice(0, 20).map((l) => l.campos),
  });
}));

// GET /datasets/:id/csv — download do arquivo
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

export default router;
