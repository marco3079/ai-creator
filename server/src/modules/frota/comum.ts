import crypto from 'crypto';
import type { Request } from 'express';
import type { Dispositivo } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ErroHttp } from '../../lib/erros';
import { emitirEvento } from '../../lib/eventos';
import type { Placa } from '../projetos/modelos';

// Formato da frota/OTA (CONTRATOS-LEVA-B §3 e §4). Mesmo formato de client/src/lib/tipos-frota.ts.
export interface TelemetriaPlaca {
  rssi?: number;
  heapLivre?: number;
  uptimeS?: number;
  temperatura?: number;
  versao?: number;
  [chave: string]: unknown;
}

export interface DispositivoFrota {
  id: number;
  nome: string;
  placa: Placa;
  porta: string;
  notas: string;
  projetoId: number | null;
  projeto: { id: number; nome: string } | null;
  chavePrefixo: string | null;
  online: boolean;
  ultimoContato: string | null;
  ip: string | null;
  telemetria: TelemetriaPlaca | null;
  buildAtualId: number | null;
  buildAlvoId: number | null;
  ultimaOta: string | null;
  statusOta: string | null;
  ultimoBuildId: number | null;
  ultimaGravacao: string | null;
  criadoEm: string;
}

// Resposta de POST /dispositivos/:id/chave (a chave em claro aparece só aqui).
export interface ChaveGerada {
  chave: string;
  prefixo: string;
}

export interface ChaveDispositivoGerada {
  chave: string; // "aicd_" + 40 hex (só para mostrar uma vez)
  prefixo: string; // primeiros 10 caracteres
  hash: string; // sha256 hex, o que fica gravado
}

const FORMATO_CHAVE = /^aicd_[0-9a-f]{40}$/;
const JANELA_LIMITE_MS = 60_000;
const LIMITE_REQUISICOES = 30;

// Gera uma chave nova. Quem chama grava hash e prefixo e devolve a chave em claro uma única vez.
export function gerarChaveDispositivo(): ChaveDispositivoGerada {
  const chave = `aicd_${crypto.randomBytes(20).toString('hex')}`;
  return { chave, prefixo: chave.slice(0, 10), hash: hashChave(chave) };
}

export function hashChave(chave: string): string {
  return crypto.createHash('sha256').update(chave).digest('hex');
}

// Compara a chave recebida com o hash guardado, em tempo constante. Sem hash ou formato inválido = falso.
export function chaveConfere(chave: string, hashEsperado: string | null): boolean {
  if (!hashEsperado || typeof chave !== 'string' || !FORMATO_CHAVE.test(chave)) {
    return false;
  }
  const recebido = Buffer.from(hashChave(chave), 'hex');
  const esperado = Buffer.from(hashEsperado, 'hex');
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

function iso(data: Date | null): string | null {
  return data ? data.toISOString() : null;
}

// Converte o registro do banco no formato DispositivoFrota. Nunca expõe chaveHash.
export function paraDispositivoFrota(
  d: Dispositivo,
  projeto: { id: number; nome: string } | null = null
): DispositivoFrota {
  return {
    id: d.id,
    nome: d.nome,
    placa: d.placa,
    porta: d.porta,
    notas: d.notas,
    projetoId: d.projetoId,
    projeto,
    chavePrefixo: d.chavePrefixo,
    online: d.online,
    ultimoContato: iso(d.ultimoContato),
    ip: d.ip,
    telemetria: (d.telemetria as TelemetriaPlaca | null) ?? null,
    buildAtualId: d.buildAtualId,
    buildAlvoId: d.buildAlvoId,
    ultimaOta: iso(d.ultimaOta),
    statusOta: d.statusOta,
    ultimoBuildId: d.ultimoBuildId,
    ultimaGravacao: iso(d.ultimaGravacao),
    criadoEm: d.criadoEm.toISOString(),
  };
}

// Versão em lote: busca os projetos (Dispositivo não tem relação com Projeto no Prisma) e monta a lista.
export async function paraDispositivosFrota(lista: Dispositivo[]): Promise<DispositivoFrota[]> {
  const ids = [...new Set(lista.map((d) => d.projetoId).filter((v): v is number => v !== null))];
  const projetos = ids.length
    ? await prisma.projeto.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const mapa = new Map(projetos.map((p) => [p.id, p]));
  return lista.map((d) =>
    paraDispositivoFrota(d, d.projetoId !== null ? mapa.get(d.projetoId) ?? null : null)
  );
}

// Publica o estado atual do dispositivo (online e statusOta) para a tela ao vivo.
export async function emitirDispositivo(id: number): Promise<void> {
  const atual = await prisma.dispositivo.findUnique({ where: { id }, select: { online: true, statusOta: true } });
  if (!atual) {
    return;
  }
  emitirEvento({ tipo: 'dispositivo', id, online: atual.online, statusOta: atual.statusOta });
}

// Limite simples em memória: 30 requisições por minuto por id de dispositivo.
const contagem = new Map<number, { inicio: number; n: number }>();

function limitar(id: number): void {
  const agora = Date.now();
  if (contagem.size > 10000) {
    for (const [chave, valor] of contagem) {
      if (agora - valor.inicio >= JANELA_LIMITE_MS) {
        contagem.delete(chave);
      }
    }
  }
  const atual = contagem.get(id);
  if (!atual || agora - atual.inicio >= JANELA_LIMITE_MS) {
    contagem.set(id, { inicio: agora, n: 1 });
    return;
  }
  atual.n += 1;
  if (atual.n > LIMITE_REQUISICOES) {
    throw new ErroHttp(429, 'Muitas requisições; tente em instantes');
  }
}

// Identifica a placa pelos cabeçalhos X-Dispositivo-Id e X-Dispositivo-Chave. Lança 401 ou 429.
export async function autenticarDispositivo(req: Request): Promise<Dispositivo> {
  const idBruto = req.get('x-dispositivo-id') ?? '';
  const chave = req.get('x-dispositivo-chave') ?? '';
  const id = /^\d+$/.test(idBruto) ? Number(idBruto) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ErroHttp(401, 'Dispositivo não autenticado');
  }
  limitar(id);
  const dispositivo = await prisma.dispositivo.findUnique({ where: { id } });
  if (!dispositivo || !chaveConfere(chave, dispositivo.chaveHash)) {
    throw new ErroHttp(401, 'Dispositivo não autenticado');
  }
  return dispositivo;
}
