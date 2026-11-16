// Eventos ao vivo de trabalhos (treinos, builds, treinos de modelo) via GET /api/eventos (SSE).
// Uma única conexão é compartilhada por todas as telas. Ela só fica aberta enquanto houver assinante.
// O EventSource nativo não envia Authorization, então a leitura é feita com fetch + getReader.

import { useEffect, useRef } from 'react';
import type { EventoTrabalho } from './tipos-melhorias';

const CHAVE_TOKEN = 'aicreator.token';
const ESPERAS_MS = [1000, 2000, 5000, 10000];

type Ouvinte = (e: EventoTrabalho) => void;

interface Conexao {
  ac: AbortController;
  timer: number | null;
}

const ouvintes = new Set<Ouvinte>();
let conexao: Conexao | null = null;
let tentativas = 0;

function notificar(e: EventoTrabalho): void {
  for (const fn of [...ouvintes]) {
    try {
      fn(e);
    } catch {
      // Erro de uma tela não derruba as outras.
    }
  }
}

function fecharConexao(): void {
  if (!conexao) return;
  if (conexao.timer !== null) window.clearTimeout(conexao.timer);
  conexao.ac.abort();
  conexao = null;
  tentativas = 0;
}

function agendarReconexao(atual: Conexao): void {
  const espera = ESPERAS_MS[Math.min(tentativas, ESPERAS_MS.length - 1)];
  tentativas += 1;
  atual.timer = window.setTimeout(() => {
    if (conexao === atual) abrirConexao();
  }, espera);
}

// Lê o corpo SSE: blocos separados por linha em branco; só "data:" conta (":" é ping e é ignorado).
async function lerFluxo(corpo: ReadableStream<Uint8Array>): Promise<void> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';

  function processarBloco(bloco: string): void {
    for (const linha of bloco.split('\n')) {
      if (!linha.startsWith('data:')) continue;
      const json = linha.slice(5).trim();
      if (!json) continue;
      try {
        const evento = JSON.parse(json) as unknown;
        if (evento && typeof evento === 'object' && 'tipo' in evento) notificar(evento as EventoTrabalho);
      } catch {
        // Linha que não é JSON válido: ignorada.
      }
    }
  }

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocos = buffer.split('\n\n');
    buffer = blocos.pop() ?? '';
    for (const bloco of blocos) processarBloco(bloco);
  }

  buffer += decodificador.decode();
  if (buffer.trim()) processarBloco(buffer);
}

async function lerConexao(atual: Conexao): Promise<void> {
  try {
    const token = localStorage.getItem(CHAVE_TOKEN);
    const cabecalhos: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) cabecalhos['Authorization'] = `Bearer ${token}`;

    const resposta = await fetch('/api/eventos', { headers: cabecalhos, signal: atual.ac.signal });
    if (conexao !== atual) return;

    // Sem autorização: não reconecta (a próxima assinatura tenta de novo).
    if (resposta.status === 401) {
      conexao = null;
      tentativas = 0;
      return;
    }
    if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);

    tentativas = 0;
    await lerFluxo(resposta.body);
  } catch {
    // Queda de rede ou abort: a reconexão abaixo decide.
  }

  if (conexao === atual && !atual.ac.signal.aborted) agendarReconexao(atual);
}

function abrirConexao(): void {
  const atual: Conexao = { ac: new AbortController(), timer: null };
  conexao = atual;
  void lerConexao(atual);
}

// Registra um ouvinte. Abre a conexão se ainda não estiver aberta. Devolve a função que cancela a assinatura.
export function assinarEventos(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  if (!conexao) abrirConexao();
  return () => {
    ouvintes.delete(fn);
    if (ouvintes.size === 0) fecharConexao();
  };
}

// Assina os eventos de trabalho. `filtro` escolhe quais interessam; `aoEvento` roda para cada um deles.
// Os callbacks ficam em ref, então a assinatura não é refeita a cada render.
export function useEventosTrabalho(
  filtro: (e: EventoTrabalho) => boolean,
  aoEvento: (e: EventoTrabalho) => void,
): void {
  const filtroRef = useRef(filtro);
  const aoEventoRef = useRef(aoEvento);
  filtroRef.current = filtro;
  aoEventoRef.current = aoEvento;

  useEffect(() => {
    return assinarEventos((e) => {
      if (filtroRef.current(e)) aoEventoRef.current(e);
    });
  }, []);
}
