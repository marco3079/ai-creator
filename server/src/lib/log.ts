import { prisma } from './prisma';

// Registra uma ação na tabela Log. Nunca lança: falha só vira aviso no console.
export async function registrar(usuarioId: number | null, acao: string, detalhe?: string): Promise<void> {
  try {
    await prisma.log.create({
      data: { usuarioId, acao, detalhe: detalhe ?? '' },
    });
  } catch (erro) {
    console.error('Falha ao registrar log:', erro instanceof Error ? erro.message : String(erro));
  }
}
