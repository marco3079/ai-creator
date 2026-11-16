import { prisma } from '../../lib/prisma';
import { calcularCusto, precoDe, type PrecosLlm } from './precos';

// Registra o uso de tokens de uma execução de LLM (tabela UsoLlm) e devolve o custo estimado.
// Nunca lança: qualquer falha vira log no console e custoUsd null.
export async function registrarUso(p: {
  agenteId: number | null;
  usuarioId: number | null;
  provedor: string;
  modelo: string;
  entrada: number;
  saida: number;
  ferramentas?: number;
}): Promise<{ custoUsd: number | null }> {
  try {
    let custoUsd: number | null = 0;
    if (p.provedor !== 'OLLAMA') {
      const plataforma = await prisma.plataforma.findUnique({ where: { id: 1 }, select: { precosLlm: true } });
      const personalizados = (plataforma?.precosLlm ?? {}) as PrecosLlm;
      const preco = precoDe(p.modelo, personalizados);
      custoUsd = preco ? calcularCusto(preco, p.entrada, p.saida) : null;
    }

    await prisma.usoLlm.create({
      data: {
        agenteId: p.agenteId,
        usuarioId: p.usuarioId,
        provedor: p.provedor,
        modelo: p.modelo,
        entrada: p.entrada,
        saida: p.saida,
        custoUsd,
        ferramentas: p.ferramentas ?? 0,
      },
    });
    return { custoUsd };
  } catch (erro) {
    console.error('Falha ao registrar uso de LLM:', erro instanceof Error ? erro.message : String(erro));
    return { custoUsd: null };
  }
}
