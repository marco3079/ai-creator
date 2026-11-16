import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { PRECOS_PADRAO, type PrecosLlm } from './precos';

// Uso e custos de LLM (CONTRATOS-MELHORIAS §7). Os totais saem da tabela UsoLlm (registrarUso).

const router = Router();

const NOME_AGENTE_REMOVIDO = 'Agente removido';
const DIA_MS = 24 * 60 * 60 * 1000;

const resumoSchema = z.object({
  dias: z.coerce.number().int('Período inválido').min(1, 'Período inválido').max(365, 'Período inválido').default(30),
});

const precoSchema = z.object({
  entrada: z.number().min(0, 'Preço não pode ser negativo').max(10000, 'Preço muito alto'),
  saida: z.number().min(0, 'Preço não pode ser negativo').max(10000, 'Preço muito alto'),
});

const atualizarPrecosSchema = z.object({
  precos: z.record(z.string().trim().min(1, 'Nome do modelo vazio').max(120, 'Nome do modelo muito longo'), precoSchema),
});

// Dia no formato YYYY-MM-DD (UTC).
function diaDe(data: Date): string {
  return data.toISOString().slice(0, 10);
}

// Preços personalizados guardados em Plataforma.precosLlm (ou {} se ainda não houver registro).
async function lerPersonalizados(): Promise<PrecosLlm> {
  const plataforma = await prisma.plataforma.findUnique({ where: { id: 1 }, select: { precosLlm: true } });
  return (plataforma?.precosLlm ?? {}) as PrecosLlm;
}

// GET /uso/resumo?dias=30 — totais, por dia (todos os dias do período), por agente e por modelo.
router.get(
  '/uso/resumo',
  autenticar,
  rota(async (req, res) => {
    const { dias } = resumoSchema.parse(req.query);

    // Início do período: meia-noite UTC de (hoje - dias + 1).
    const hoje = new Date();
    const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) - (dias - 1) * DIA_MS);

    const usos = await prisma.usoLlm.findMany({
      where: { criadoEm: { gte: inicio } },
      select: { agenteId: true, provedor: true, modelo: true, entrada: true, saida: true, custoUsd: true, criadoEm: true },
    });

    // Todos os dias do período, inclusive os sem uso.
    const porDia = new Map<string, { custoUsd: number; entrada: number; saida: number; execucoes: number }>();
    for (let i = 0; i < dias; i++) {
      porDia.set(diaDe(new Date(inicio.getTime() + i * DIA_MS)), { custoUsd: 0, entrada: 0, saida: 0, execucoes: 0 });
    }

    const porAgente = new Map<number | null, { execucoes: number; entrada: number; saida: number; custoUsd: number }>();
    const porModelo = new Map<
      string,
      { modelo: string; provedor: string; execucoes: number; entrada: number; saida: number; custoUsd: number | null }
    >();

    let totalUsd = 0;
    let semPreco = 0;
    let entrada = 0;
    let saida = 0;

    for (const uso of usos) {
      const custo = uso.custoUsd ?? 0;
      if (uso.custoUsd === null) semPreco += 1;
      totalUsd += custo;
      entrada += uso.entrada;
      saida += uso.saida;

      const dia = porDia.get(diaDe(uso.criadoEm));
      if (dia) {
        dia.custoUsd += custo;
        dia.entrada += uso.entrada;
        dia.saida += uso.saida;
        dia.execucoes += 1;
      }

      const agente = porAgente.get(uso.agenteId) ?? { execucoes: 0, entrada: 0, saida: 0, custoUsd: 0 };
      agente.execucoes += 1;
      agente.entrada += uso.entrada;
      agente.saida += uso.saida;
      agente.custoUsd += custo;
      porAgente.set(uso.agenteId, agente);

      const chaveModelo = `${uso.provedor}|${uso.modelo}`;
      const modelo = porModelo.get(chaveModelo) ?? {
        modelo: uso.modelo,
        provedor: uso.provedor,
        execucoes: 0,
        entrada: 0,
        saida: 0,
        custoUsd: null,
      };
      modelo.execucoes += 1;
      modelo.entrada += uso.entrada;
      modelo.saida += uso.saida;
      // Custo do modelo: soma dos custos conhecidos; null enquanto nenhuma execução tiver preço.
      if (uso.custoUsd !== null) modelo.custoUsd = (modelo.custoUsd ?? 0) + uso.custoUsd;
      porModelo.set(chaveModelo, modelo);
    }

    // Nome atual dos agentes (agente apagado ou sem vínculo vira "Agente removido").
    const idsAgentes = [...porAgente.keys()].filter((id): id is number => id !== null);
    const agentes = idsAgentes.length
      ? await prisma.agente.findMany({ where: { id: { in: idsAgentes } }, select: { id: true, nome: true } })
      : [];
    const nomes = new Map(agentes.map((a) => [a.id, a.nome]));

    res.json({
      dias,
      totalUsd,
      semPreco,
      execucoes: usos.length,
      entrada,
      saida,
      porDia: [...porDia.entries()].map(([dia, v]) => ({ dia, ...v })),
      porAgente: [...porAgente.entries()]
        .map(([agenteId, v]) => ({
          agenteId,
          nome: agenteId !== null && nomes.has(agenteId) ? (nomes.get(agenteId) as string) : NOME_AGENTE_REMOVIDO,
          ...v,
        }))
        .sort((a, b) => b.custoUsd - a.custoUsd || b.execucoes - a.execucoes),
      porModelo: [...porModelo.values()].sort((a, b) => (b.custoUsd ?? 0) - (a.custoUsd ?? 0) || b.execucoes - a.execucoes),
    });
  }),
);

// GET /uso/precos — preços padrão da plataforma e os personalizados (USD por 1M tokens).
router.get(
  '/uso/precos',
  autenticar,
  rota(async (_req, res) => {
    res.json({ padrao: PRECOS_PADRAO, personalizados: await lerPersonalizados() });
  }),
);

// PUT /uso/precos — substitui os preços personalizados (ADMIN). Enviar {} volta tudo ao padrão.
router.put(
  '/uso/precos',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    const { precos } = atualizarPrecosSchema.parse(req.body ?? {});
    await prisma.plataforma.upsert({
      where: { id: 1 },
      update: { precosLlm: precos as unknown as Prisma.InputJsonObject },
      create: { id: 1, precosLlm: precos as unknown as Prisma.InputJsonObject },
    });
    await registrar(req.usuario?.id ?? null, 'uso.precos', `${Object.keys(precos).length} modelo(s) com preço personalizado`);
    res.json({ padrao: PRECOS_PADRAO, personalizados: precos });
  }),
);

export default router;
