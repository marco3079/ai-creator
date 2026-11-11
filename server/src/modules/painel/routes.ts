import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { rota } from '../../lib/erros';
import { autenticar } from '../../lib/auth';

const router = Router();

const DIAS = 14;
const RECENTES = 6;

// Data local no formato YYYY-MM-DD.
function diaLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

router.get(
  '/painel',
  autenticar,
  rota(async (_req, res) => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - (DIAS - 1));

    const [
      agentesLlm,
      agentesTinyml,
      projetos,
      dispositivos,
      treinosSucesso,
      buildsSucesso,
      buildsRecentes,
      treinosRecentes,
      buildsDoPeriodo,
      ultimoAgente,
    ] = await Promise.all([
      prisma.agente.count({ where: { tipo: 'LLM' } }),
      prisma.agente.count({ where: { tipo: 'TINYML' } }),
      prisma.projeto.count(),
      prisma.dispositivo.count(),
      prisma.treino.count({ where: { status: 'SUCESSO' } }),
      prisma.build.count({ where: { status: 'SUCESSO' } }),
      prisma.build.findMany({
        orderBy: { criadoEm: 'desc' },
        take: RECENTES,
        select: { id: true, status: true, criadoEm: true, projeto: { select: { nome: true } } },
      }),
      prisma.treino.findMany({
        orderBy: { criadoEm: 'desc' },
        take: RECENTES,
        select: { id: true, status: true, criadoEm: true, agente: { select: { nome: true } } },
      }),
      prisma.build.findMany({
        where: { criadoEm: { gte: inicio }, status: { in: ['SUCESSO', 'FALHA'] } },
        select: { criadoEm: true, status: true },
      }),
      prisma.agente.findFirst({
        orderBy: { atualizadoEm: 'desc' },
        include: { projeto: { select: { id: true, nome: true } } },
      }),
    ]);

    // Dias zerados também aparecem: sempre 14 entradas.
    const porDia = new Map<string, { dia: string; sucesso: number; falha: number }>();
    for (let i = 0; i < DIAS; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      const dia = diaLocal(d);
      porDia.set(dia, { dia, sucesso: 0, falha: 0 });
    }
    for (const build of buildsDoPeriodo) {
      const entrada = porDia.get(diaLocal(build.criadoEm));
      if (!entrada) continue;
      if (build.status === 'SUCESSO') entrada.sucesso++;
      else if (build.status === 'FALHA') entrada.falha++;
    }

    const recentes = [
      ...buildsRecentes.map((b) => ({
        tipo: 'BUILD' as const,
        id: b.id,
        titulo: `Build #${b.id} · ${b.projeto.nome}`,
        status: b.status,
        criadoEm: b.criadoEm,
      })),
      ...treinosRecentes.map((t) => ({
        tipo: 'TREINO' as const,
        id: t.id,
        titulo: `Treino #${t.id} · ${t.agente.nome}`,
        status: t.status,
        criadoEm: t.criadoEm,
      })),
    ]
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .slice(0, RECENTES);

    const destaque = ultimoAgente
      ? {
          id: ultimoAgente.id,
          nome: ultimoAgente.nome,
          slug: ultimoAgente.slug,
          descricao: ultimoAgente.descricao,
          tipo: ultimoAgente.tipo,
          tags: ultimoAgente.tags,
          provedor: ultimoAgente.provedor,
          modelo: ultimoAgente.modelo,
          versao: ultimoAgente.versao,
          atualizadoEm: ultimoAgente.atualizadoEm,
          projeto: ultimoAgente.projeto,
        }
      : null;

    res.json({
      contagens: {
        agentesLlm,
        agentesTinyml,
        projetos,
        dispositivos,
        treinosSucesso,
        buildsSucesso,
      },
      buildsPorDia: [...porDia.values()],
      recentes,
      destaque,
    });
  })
);

export default router;
