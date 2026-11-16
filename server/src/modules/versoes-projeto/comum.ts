import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// Histórico de versões dos projetos de firmware (B06). Cada versão é uma foto de todos os arquivos.

export interface ArquivoVersao {
  caminho: string;
  conteudo: string;
}

export interface OpcoesVersao {
  mensagem: string;
  autorId: number | null;
  buildId: number | null;
}

export type ResultadoVersao =
  | { criada: true; numero: number }
  | { criada: false; numero: number }; // numero = última versão (idêntica ao conteúdo atual)

// sha256 dos arquivos ordenados por caminho (independe da ordem de entrada).
export function hashArquivos(arquivos: ArquivoVersao[]): string {
  const ordenados = [...arquivos].sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const arquivo of ordenados) {
    hash.update(arquivo.caminho, 'utf8');
    hash.update('\0');
    hash.update(arquivo.conteudo, 'utf8');
    hash.update('\0');
  }
  return hash.digest('hex');
}

// Converte o Json guardado em ArquivoVersao[] (tolerante a formatos inesperados).
export function arquivosDaVersao(valor: Prisma.JsonValue): ArquivoVersao[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((item): item is { caminho: string; conteudo: string } => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { caminho?: unknown }).caminho === 'string' &&
        typeof (item as { conteudo?: unknown }).conteudo === 'string'
      );
    })
    .map((item) => ({ caminho: item.caminho, conteudo: item.conteudo }));
}

function ehConflitoUnico(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}

// Cria uma versão com o estado atual dos arquivos do projeto. Não cria se o conteúdo for idêntico
// à última versão (devolve criada: false). Tenta de novo em caso de corrida no número sequencial.
export async function criarVersao(projetoId: number, opcoes: OpcoesVersao): Promise<ResultadoVersao> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const atuais = await tx.arquivoProjeto.findMany({
          where: { projetoId },
          select: { caminho: true, conteudo: true },
          orderBy: { caminho: 'asc' },
        });
        const hash = hashArquivos(atuais);
        const ultima = await tx.versaoProjeto.findFirst({
          where: { projetoId },
          orderBy: { numero: 'desc' },
          select: { numero: true, hash: true },
        });
        if (ultima && ultima.hash === hash) {
          return { criada: false, numero: ultima.numero };
        }
        const numero = (ultima?.numero ?? 0) + 1;
        await tx.versaoProjeto.create({
          data: {
            projetoId,
            numero,
            mensagem: opcoes.mensagem,
            arquivos: atuais as unknown as Prisma.InputJsonValue,
            autorId: opcoes.autorId,
            buildId: opcoes.buildId,
            hash,
          },
        });
        return { criada: true, numero };
      });
    } catch (erro) {
      if (tentativa < 3 && ehConflitoUnico(erro)) continue;
      throw erro;
    }
  }
}

// Nomes dos autores das versões (autorId não tem relação no schema, então busca à parte).
export async function nomesDosAutores(ids: number[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<number, string>();
  if (unicos.length === 0) return mapa;
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nome: true },
  });
  for (const usuario of usuarios) mapa.set(usuario.id, usuario.nome);
  return mapa;
}
