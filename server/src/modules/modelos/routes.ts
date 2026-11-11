import { rm } from 'node:fs/promises';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { caminhoDados } from '../../lib/arquivos';
import { gerarSlug, slugUnico } from '../../lib/slug';
import { registrar } from '../../lib/log';
import { AtualizarModeloEsquema, NovoModeloEsquema } from './esquemas';
import {
  buscarModelo,
  configInicial,
  incluirModelo,
  montarConfig,
  paraModelo,
  paraResumo,
  validarCompatibilidade,
} from './comum';
import { obterOpcoes } from './opcoes';
import { ConfigModelo, TIPOS_MODELO_VALIDOS, TipoModelo } from './padroes';

const router = Router();

// Slug único a partir do nome do modelo.
async function slugDoModelo(nome: string): Promise<string> {
  return slugUnico(gerarSlug(nome), async (s) => (await prisma.modelo.findUnique({ where: { slug: s } })) !== null);
}

// Confere o dataset (existe) e a compatibilidade com tipo/tarefa. Devolve o tipo do dataset.
async function checarDataset(datasetId: number, tipo: TipoModelo, tarefa: string): Promise<void> {
  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId }, select: { tipo: true } });
  if (!dataset) throw new ErroHttp(404, 'Dataset não encontrado');
  validarCompatibilidade(tipo, tarefa as Parameters<typeof validarCompatibilidade>[1], dataset.tipo);
}

// GET /modelos?tipo=&busca=
router.get('/modelos', autenticar, rota(async (req, res) => {
  const tipo = typeof req.query.tipo === 'string' && req.query.tipo !== '' ? req.query.tipo : undefined;
  const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
  if (tipo !== undefined && !TIPOS_MODELO_VALIDOS.includes(tipo as TipoModelo)) {
    throw new ErroHttp(400, 'Tipo de modelo inválido');
  }

  const lista = await prisma.modelo.findMany({
    where: {
      ...(tipo ? { tipo: tipo as TipoModelo } : {}),
      ...(busca
        ? {
            OR: [
              { nome: { contains: busca, mode: 'insensitive' } },
              { descricao: { contains: busca, mode: 'insensitive' } },
              { tags: { has: busca } },
            ],
          }
        : {}),
    },
    include: incluirModelo,
    orderBy: { atualizadoEm: 'desc' },
  });
  res.json(lista.map(paraResumo));
}));

// GET /modelos/opcoes — declarada antes de /modelos/:id
router.get('/modelos/opcoes', autenticar, rota(async (_req, res) => {
  res.json(await obterOpcoes());
}));

// GET /modelos/:id (id ou slug)
router.get('/modelos/:id', autenticar, rota(async (req, res) => {
  const modelo = await buscarModelo(req.params.id);
  res.json(paraModelo(modelo));
}));

// POST /modelos
router.post('/modelos', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const dados = NovoModeloEsquema.parse(req.body);
  if (dados.datasetId) await checarDataset(dados.datasetId, dados.tipo, dados.tarefa);
  else validarCompatibilidade(dados.tipo, dados.tarefa);

  const config = configInicial(dados.tipo, dados.tarefa, dados.config ?? null);
  const slug = await slugDoModelo(dados.nome);

  const criado = await prisma.modelo.create({
    data: {
      nome: dados.nome,
      slug,
      descricao: dados.descricao ?? '',
      tipo: dados.tipo,
      tarefa: dados.tarefa,
      datasetId: dados.datasetId ?? null,
      config: config as unknown as Prisma.InputJsonValue,
      tags: dados.tags ?? [],
      autorId: req.usuario?.id ?? null,
    },
  });
  await registrar(req.usuario?.id ?? null, 'modelo.criar', `${criado.nome} (${criado.tipo})`);

  res.status(201).json(paraModelo(await buscarModelo(criado.id)));
}));

// PUT /modelos/:id — tipo e tarefa não mudam
router.put('/modelos/:id', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const atual = await buscarModelo(req.params.id);
  const dados = AtualizarModeloEsquema.parse(req.body);
  const tipo = atual.tipo as TipoModelo;

  if (dados.datasetId) await checarDataset(dados.datasetId, tipo, atual.tarefa);

  const dadosAtualizacao: Prisma.ModeloUpdateInput = {};
  if (dados.nome !== undefined) dadosAtualizacao.nome = dados.nome;
  if (dados.descricao !== undefined) dadosAtualizacao.descricao = dados.descricao;
  if (dados.tags !== undefined) dadosAtualizacao.tags = dados.tags;
  if (dados.datasetId !== undefined) {
    dadosAtualizacao.dataset = dados.datasetId ? { connect: { id: dados.datasetId } } : { disconnect: true };
  }
  if (dados.config !== undefined && dados.config !== null) {
    const config: ConfigModelo = montarConfig(tipo, atual.config as unknown as ConfigModelo, dados.config);
    dadosAtualizacao.config = config as unknown as Prisma.InputJsonValue;
  }

  if (dados.nome !== undefined && dados.nome !== atual.nome) {
    dadosAtualizacao.slug = await slugUnico(gerarSlug(dados.nome), async (s) => {
      const outro = await prisma.modelo.findUnique({ where: { slug: s } });
      return outro !== null && outro.id !== atual.id;
    });
  }

  await prisma.modelo.update({ where: { id: atual.id }, data: dadosAtualizacao });
  await registrar(req.usuario?.id ?? null, 'modelo.atualizar', atual.nome);

  res.json(paraModelo(await buscarModelo(atual.id)));
}));

// DELETE /modelos/:id — apaga também /data/modelos/<id>
router.delete('/modelos/:id', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const modelo = await buscarModelo(req.params.id);
  await prisma.modelo.delete({ where: { id: modelo.id } });
  await rm(caminhoDados('modelos', String(modelo.id)), { recursive: true, force: true });
  await registrar(req.usuario?.id ?? null, 'modelo.excluir', modelo.nome);
  res.status(204).end();
}));

// POST /modelos/:id/duplicar — cópia sem treinos
router.post('/modelos/:id/duplicar', autenticar, exigirPerfil('ADMIN', 'DEV'), rota(async (req, res) => {
  const original = await buscarModelo(req.params.id);
  const nome = `${original.nome} (cópia)`;
  const copia = await prisma.modelo.create({
    data: {
      nome,
      slug: await slugDoModelo(nome),
      descricao: original.descricao,
      tipo: original.tipo,
      tarefa: original.tarefa,
      datasetId: original.datasetId,
      config: original.config as Prisma.InputJsonValue,
      tags: original.tags,
      autorId: req.usuario?.id ?? null,
    },
  });
  await registrar(req.usuario?.id ?? null, 'modelo.duplicar', `${original.nome} -> ${nome}`);
  res.status(201).json(paraModelo(await buscarModelo(copia.id)));
}));

export default router;
