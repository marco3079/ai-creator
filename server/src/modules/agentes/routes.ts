import express from 'express';
import { Prisma } from '@prisma/client';
import type { Agente as AgenteBanco } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ErroHttp, rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { gerarSlug, slugUnico } from '../../lib/slug';
import {
  AgenteAtualizacaoEsquema,
  AgenteEntradaEsquema,
  ImportarEsquema,
  type AgenteAtualizacao,
} from './esquemas';
import { deMarkdown, paraMarkdown } from './formatoMd';
import {
  AGENTE_LLM_PADRAO,
  CONFIG_TINYML_PADRAO,
  MODELO_PADRAO_POR_PROVEDOR,
  type Agente,
  type AgenteResumo,
  type ConfigTinyml,
  type ProvedorTipo,
} from './padroes';

const router = express.Router();

const incluirProjeto = { projeto: { select: { id: true, nome: true } } } as const;
type ComProjeto = AgenteBanco & { projeto: { id: number; nome: string } | null };

// Campos gravados de um agente (sem id, slug, autor, versão e datas).
interface Campos {
  nome: string;
  descricao: string;
  tipo: 'LLM' | 'TINYML';
  tags: string[];
  projetoId: number | null;
  provedor: ProvedorTipo | null;
  modelo: string | null;
  promptSistema: string | null;
  esforco: string | null;
  temperatura: number | null;
  maxTokens: number | null;
  ferramentas: string[];
  configTinyml: ConfigTinyml | null;
}

function camposVazios(tipo: 'LLM' | 'TINYML'): Campos {
  return {
    nome: '',
    descricao: '',
    tipo,
    tags: [],
    projetoId: null,
    provedor: null,
    modelo: null,
    promptSistema: null,
    esforco: null,
    temperatura: null,
    maxTokens: null,
    ferramentas: [],
    configTinyml: null,
  };
}

function doBanco(a: AgenteBanco): Campos {
  return {
    nome: a.nome,
    descricao: a.descricao,
    tipo: a.tipo,
    tags: a.tags,
    projetoId: a.projetoId,
    provedor: a.provedor,
    modelo: a.modelo,
    promptSistema: a.promptSistema,
    esforco: a.esforco,
    temperatura: a.temperatura,
    maxTokens: a.maxTokens,
    ferramentas: (a.ferramentas as string[]) ?? [],
    configTinyml: (a.configTinyml as unknown as ConfigTinyml | null) ?? null,
  };
}

// Aplica a entrada sobre a base: campo ausente mantém a base; campo nulo limpa (o padrão do tipo é aplicado depois).
function mesclar(base: Campos, e: AgenteAtualizacao): Campos {
  return {
    nome: e.nome ?? base.nome,
    descricao: e.descricao ?? base.descricao,
    tipo: e.tipo ?? base.tipo,
    tags: e.tags ?? base.tags,
    projetoId: e.projetoId !== undefined ? e.projetoId : base.projetoId,
    provedor: e.provedor !== undefined ? e.provedor : base.provedor,
    modelo: e.modelo !== undefined ? e.modelo : base.modelo,
    promptSistema: e.promptSistema !== undefined ? e.promptSistema : base.promptSistema,
    esforco: e.esforco !== undefined ? e.esforco : base.esforco,
    temperatura: e.temperatura !== undefined ? e.temperatura : base.temperatura,
    maxTokens: e.maxTokens !== undefined ? e.maxTokens : base.maxTokens,
    ferramentas: e.ferramentas ?? base.ferramentas,
    configTinyml: e.configTinyml !== undefined ? e.configTinyml : base.configTinyml,
  };
}

// Preenche os padrões do tipo (LLM: provedor/modelo/etc.; TINYML: CONFIG_TINYML_PADRAO).
function completar(c: Campos): Campos {
  const r = { ...c };
  if (r.tipo === 'LLM') {
    r.provedor = r.provedor ?? AGENTE_LLM_PADRAO.provedor;
    r.modelo = r.modelo ?? MODELO_PADRAO_POR_PROVEDOR[r.provedor];
    r.esforco = r.esforco ?? AGENTE_LLM_PADRAO.esforco;
    r.temperatura = r.temperatura ?? AGENTE_LLM_PADRAO.temperatura;
    r.maxTokens = r.maxTokens ?? AGENTE_LLM_PADRAO.maxTokens;
    r.promptSistema = r.promptSistema ?? '';
  } else {
    r.configTinyml = r.configTinyml ?? structuredClone(CONFIG_TINYML_PADRAO);
  }
  return r;
}

// ultimoTreinoId é escrito pelo trainer (callback), então o valor do banco prevalece sobre o que vem do cliente.
function preservarUltimoTreino(c: Campos, atual: AgenteBanco): Campos {
  if (c.configTinyml === null) return c;
  const ultimoTreinoId = (atual.configTinyml as unknown as ConfigTinyml | null)?.ultimoTreinoId ?? null;
  return { ...c, configTinyml: { ...c.configTinyml, ultimoTreinoId } };
}

const json = (valor: unknown) => valor as Prisma.InputJsonValue;

function paraDados(c: Campos) {
  return {
    nome: c.nome,
    descricao: c.descricao,
    tipo: c.tipo,
    tags: c.tags,
    projetoId: c.projetoId,
    provedor: c.provedor,
    modelo: c.modelo,
    promptSistema: c.promptSistema,
    esforco: c.esforco,
    temperatura: c.temperatura,
    maxTokens: c.maxTokens,
    ferramentas: json(c.ferramentas),
    configTinyml: c.configTinyml === null ? Prisma.DbNull : json(c.configTinyml),
  };
}

// Snapshot = agente completo serializado, sem relações.
function snapshotDe(linha: AgenteBanco): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(linha)) as Prisma.InputJsonValue;
}

function paraResumo(a: ComProjeto): AgenteResumo {
  return {
    id: a.id,
    nome: a.nome,
    slug: a.slug,
    descricao: a.descricao,
    tipo: a.tipo,
    tags: a.tags,
    provedor: a.provedor,
    modelo: a.modelo,
    versao: a.versao,
    atualizadoEm: a.atualizadoEm,
    projeto: a.projeto,
  };
}

function paraAgente(a: ComProjeto): Agente {
  const c = doBanco(a);
  return {
    ...paraResumo(a),
    promptSistema: c.promptSistema,
    esforco: c.esforco,
    temperatura: c.temperatura,
    maxTokens: c.maxTokens,
    ferramentas: c.ferramentas,
    configTinyml: c.configTinyml,
    projetoId: c.projetoId,
    criadoEm: a.criadoEm,
  };
}

// Aceita id numérico ou slug.
async function buscarAgente(idOuSlug: string): Promise<ComProjeto> {
  const onde = /^\d+$/.test(idOuSlug) ? { id: Number(idOuSlug) } : { slug: idOuSlug };
  const agente = await prisma.agente.findUnique({ where: onde, include: incluirProjeto });
  if (!agente) throw new ErroHttp(404, 'Agente não encontrado');
  return agente;
}

async function buscarVersao(agenteId: number, versao: string) {
  const numero = Number(versao);
  const registro = Number.isInteger(numero)
    ? await prisma.versaoAgente.findUnique({ where: { agenteId_versao: { agenteId, versao: numero } } })
    : null;
  if (!registro) throw new ErroHttp(404, 'Versão não encontrada');
  return registro;
}

// Cria o agente e a VersaoAgente 1. Retorna o id.
async function gravarNovo(c: Campos, autorId: number | null, nota = 'Criação'): Promise<number> {
  const campos = completar(c);
  const slug = await slugUnico(gerarSlug(campos.nome), async (s) => (await prisma.agente.count({ where: { slug: s } })) > 0);
  const criado = await prisma.$transaction(async (tx) => {
    const linha = await tx.agente.create({ data: { ...paraDados(campos), slug, autorId } });
    await tx.versaoAgente.create({
      data: { agenteId: linha.id, versao: linha.versao, nota, snapshot: snapshotDe(linha) },
    });
    return linha;
  });
  return criado.id;
}

// Atualiza o agente, incrementa a versão e grava a VersaoAgente com o snapshot completo.
async function atualizarAgente(atual: AgenteBanco, c: Campos, nota: string): Promise<void> {
  const campos = completar(c);
  const versao = atual.versao + 1;
  await prisma.$transaction(async (tx) => {
    const linha = await tx.agente.update({
      where: { id: atual.id },
      data: { ...paraDados(campos), versao },
    });
    await tx.versaoAgente.create({
      data: { agenteId: atual.id, versao, nota, snapshot: snapshotDe(linha) },
    });
  });
}

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroHttp(400, 'JSON inválido na importação');
  }
}

// Exportação em JSON: o Agente sem os ids.
function semIds(a: Agente): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...a };
  delete copia.id;
  delete copia.projetoId;
  delete copia.projeto;
  return copia;
}

router.get(
  '/agentes',
  autenticar,
  rota(async (req, res) => {
    const filtro: Prisma.AgenteWhereInput = {};
    const tipo = req.query.tipo;
    if (tipo === 'LLM' || tipo === 'TINYML') filtro.tipo = tipo;
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    if (busca) {
      filtro.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { descricao: { contains: busca, mode: 'insensitive' } },
        { tags: { has: busca } },
      ];
    }
    const lista = await prisma.agente.findMany({
      where: filtro,
      orderBy: { atualizadoEm: 'desc' },
      include: incluirProjeto,
    });
    res.json(lista.map(paraResumo));
  }),
);

// Rota de importação antes das rotas com :id, para não confundir "importar" com um id.
router.post(
  '/agentes/importar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const { conteudo, formato } = ImportarEsquema.parse(req.body);
    const entrada =
      formato === 'md'
        ? deMarkdown(conteudo)
        : AgenteEntradaEsquema.parse(lerJson(conteudo));
    const usuarioId = req.usuario!.id;
    const slug = gerarSlug(entrada.nome);

    const existente = await prisma.agente.findUnique({ where: { slug } });
    if (existente) {
      const mesclado = preservarUltimoTreino(mesclar(doBanco(existente), entrada), existente);
      await atualizarAgente(existente, mesclado, 'Importado');
      await registrar(usuarioId, 'Importou agente', `${slug} (atualizado)`);
      res.json(paraAgente(await buscarAgente(String(existente.id))));
      return;
    }

    const id = await gravarNovo(mesclar(camposVazios(entrada.tipo), entrada), usuarioId, 'Importado');
    await registrar(usuarioId, 'Importou agente', slug);
    res.status(201).json(paraAgente(await buscarAgente(String(id))));
  }),
);

router.get(
  '/agentes/:id',
  autenticar,
  rota(async (req, res) => {
    res.json(paraAgente(await buscarAgente(req.params.id)));
  }),
);

router.post(
  '/agentes',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const dados = AgenteEntradaEsquema.parse(req.body);
    const usuarioId = req.usuario!.id;
    const id = await gravarNovo(mesclar(camposVazios(dados.tipo), dados), usuarioId);
    await registrar(usuarioId, 'Criou agente', dados.nome);
    res.status(201).json(paraAgente(await buscarAgente(String(id))));
  }),
);

router.put(
  '/agentes/:id',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const dados = AgenteAtualizacaoEsquema.parse(req.body);
    const atual = await buscarAgente(req.params.id);
    const mesclado = preservarUltimoTreino(mesclar(doBanco(atual), dados), atual);
    await atualizarAgente(atual, mesclado, dados.nota ?? '');
    await registrar(req.usuario!.id, 'Alterou agente', atual.slug);
    res.json(paraAgente(await buscarAgente(String(atual.id))));
  }),
);

router.delete(
  '/agentes/:id',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const atual = await buscarAgente(req.params.id);
    await prisma.agente.delete({ where: { id: atual.id } });
    await registrar(req.usuario!.id, 'Excluiu agente', atual.slug);
    res.status(204).end();
  }),
);

router.post(
  '/agentes/:id/duplicar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const origem = await buscarAgente(req.params.id);
    const copia = doBanco(origem);
    copia.nome = `${origem.nome} (cópia)`;
    const usuarioId = req.usuario!.id;
    const id = await gravarNovo(copia, usuarioId);
    await registrar(usuarioId, 'Duplicou agente', origem.slug);
    res.status(201).json(paraAgente(await buscarAgente(String(id))));
  }),
);

router.get(
  '/agentes/:id/versoes',
  autenticar,
  rota(async (req, res) => {
    const agente = await buscarAgente(req.params.id);
    const versoes = await prisma.versaoAgente.findMany({
      where: { agenteId: agente.id },
      orderBy: { versao: 'desc' },
      select: { versao: true, nota: true, criadoEm: true },
    });
    res.json(versoes);
  }),
);

router.get(
  '/agentes/:id/versoes/:versao',
  autenticar,
  rota(async (req, res) => {
    const agente = await buscarAgente(req.params.id);
    const v = await buscarVersao(agente.id, req.params.versao);
    res.json({ versao: v.versao, nota: v.nota, criadoEm: v.criadoEm, snapshot: v.snapshot });
  }),
);

router.post(
  '/agentes/:id/versoes/:versao/restaurar',
  autenticar,
  exigirPerfil('ADMIN', 'DEV'),
  rota(async (req, res) => {
    const atual = await buscarAgente(req.params.id);
    const v = await buscarVersao(atual.id, req.params.versao);
    const c = preservarUltimoTreino(doBanco(v.snapshot as unknown as AgenteBanco), atual);
    // O projeto do snapshot pode ter sido apagado desde então.
    if (c.projetoId !== null) {
      const existe = await prisma.projeto.count({ where: { id: c.projetoId } });
      if (existe === 0) c.projetoId = null;
    }
    await atualizarAgente(atual, c, `Restaurado da v${v.versao}`);
    await registrar(req.usuario!.id, 'Restaurou versão de agente', `${atual.slug} v${v.versao}`);
    res.json(paraAgente(await buscarAgente(String(atual.id))));
  }),
);

router.get(
  '/agentes/:id/exportar',
  autenticar,
  rota(async (req, res) => {
    const formato = typeof req.query.formato === 'string' ? req.query.formato : 'md';
    if (formato !== 'md' && formato !== 'json') {
      throw new ErroHttp(400, 'Formato inválido: use md ou json');
    }
    const agente = paraAgente(await buscarAgente(req.params.id));
    if (formato === 'md') {
      if (agente.tipo !== 'LLM') throw new ErroHttp(400, 'Só agentes LLM podem ser exportados em .md');
      res.type('text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${agente.slug}.md"`);
      res.send(paraMarkdown(agente));
      return;
    }
    res.json(semIds(agente));
  }),
);

export default router;
