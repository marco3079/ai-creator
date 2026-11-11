import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ErroHttp } from '../../lib/erros';
import { caminhoDados } from '../../lib/arquivos';

// Datasets de imagens (zip) e de conversas (JSONL) — CONTRATOS-MODELOS §4 "datasets".

export const EXTENSOES_IMAGEM = ['jpg', 'jpeg', 'png', 'bmp', 'gif'];
export const MINIMO_CLASSES = 2;
export const MINIMO_IMAGENS_POR_CLASSE = 2;
export const MINIMO_CONVERSAS = 10;

// Proteção contra zip bomba (tamanho declarado e tamanho real).
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_ENTRADAS = 20000;
export const MAX_IMAGEM_BYTES = 25 * 1024 * 1024;

export interface LimitesZip {
  totalBytes: number;
  entradas: number;
  imagemBytes: number;
}

const LIMITES_PADRAO: LimitesZip = {
  totalBytes: MAX_TOTAL_BYTES,
  entradas: MAX_ENTRADAS,
  imagemBytes: MAX_IMAGEM_BYTES,
};

const PAPEIS_VALIDOS = ['system', 'user', 'assistant'];

export function ehImagem(nome: string): boolean {
  const extensao = path.extname(nome).slice(1).toLowerCase();
  return EXTENSOES_IMAGEM.includes(extensao);
}

// Remove o prefixo "./" repetido do início do caminho.
export function normalizarCaminho(caminho: string): string {
  return caminho.replace(/^(\.\/)+/, '');
}

// Caminho relativo seguro (sem "..", sem absoluto, sem unidade de disco, sem NUL).
// Um "./" inicial é aceito e removido antes da validação.
export function caminhoSeguro(caminho: string): boolean {
  const c = normalizarCaminho(caminho);
  if (!c || c.startsWith('/') || /^[a-zA-Z]:/.test(c) || c.includes('\0')) return false;
  return c.split('/').every((parte) => parte !== '..' && parte !== '.');
}

export interface ResumoImagens {
  classes: string[];
  amostras: number;
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

// Extrai o zip para /data/datasets/<id>/. Aceita "classe/arquivo.jpg" ou "raiz/classe/arquivo.jpg"
// (uma pasta raiz única é desembrulhada). Ignora __MACOSX e arquivos ocultos.
// Limites: tamanho descomprimido declarado (validado antes de extrair) e tamanho real (durante a
// gravação). Ao estourar, a pasta do dataset é apagada e a resposta é 400.
export async function salvarImagensZip(
  id: number,
  buffer: Buffer,
  limites: Partial<LimitesZip> = {}
): Promise<ResumoImagens> {
  const lim: LimitesZip = { ...LIMITES_PADRAO, ...limites };
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ErroHttp(400, 'Arquivo zip inválido');
  }

  const entradas = zip.getEntries();
  if (entradas.length > lim.entradas) {
    throw new ErroHttp(400, `O zip tem arquivos demais (máx. ${lim.entradas})`);
  }

  const candidatos: { caminho: string[]; entrada: AdmZip.IZipEntry; nome: string }[] = [];
  let declarado = 0;
  for (const entrada of entradas) {
    if (entrada.isDirectory) continue;
    const nome = normalizarCaminho(entrada.entryName.replace(/\\/g, '/'));
    if (!caminhoSeguro(nome)) {
      throw new ErroHttp(400, `Caminho inválido no zip: ${nome}`);
    }

    declarado += entrada.header.size;
    if (declarado > lim.totalBytes) {
      throw new ErroHttp(400, `O zip descomprimido passa de ${mb(lim.totalBytes)}`);
    }

    const partes = nome.split('/').filter((p) => p !== '');
    if (partes.includes('__MACOSX') || partes.some((p) => p.startsWith('.'))) continue;
    if (!ehImagem(nome)) continue;
    if (entrada.header.size > lim.imagemBytes) {
      throw new ErroHttp(400, `A imagem ${nome} passa de ${mb(lim.imagemBytes)}`);
    }
    candidatos.push({ caminho: partes, entrada, nome });
  }

  // Remove a pasta raiz única, se existir.
  let itens = candidatos;
  if (candidatos.length > 0 && candidatos.every((c) => c.caminho.length === 3 && c.caminho[0] === candidatos[0].caminho[0])) {
    itens = candidatos.map((c) => ({ ...c, caminho: c.caminho.slice(1) }));
  }
  if (itens.some((c) => c.caminho.length !== 2)) {
    throw new ErroHttp(400, 'Estrutura do zip inválida: use uma pasta por classe (classe/imagem.jpg)');
  }

  // Conta por classe e valida o mínimo.
  const porClasse = new Map<string, typeof itens>();
  for (const item of itens) {
    const classe = item.caminho[0];
    porClasse.set(classe, [...(porClasse.get(classe) ?? []), item]);
  }
  const classes = [...porClasse.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (classes.length < MINIMO_CLASSES) {
    throw new ErroHttp(400, `O zip precisa de pelo menos ${MINIMO_CLASSES} classes (pastas).`);
  }
  for (const classe of classes) {
    if ((porClasse.get(classe)?.length ?? 0) < MINIMO_IMAGENS_POR_CLASSE) {
      throw new ErroHttp(400, `A classe "${classe}" precisa de pelo menos ${MINIMO_IMAGENS_POR_CLASSE} imagens.`);
    }
  }

  // Grava (substitui o conteúdo anterior da pasta), contando o tamanho real.
  const pasta = caminhoDados('datasets', String(id));
  await rm(pasta, { recursive: true, force: true });
  let amostras = 0;
  let real = 0;
  try {
    for (const item of itens) {
      const dados = item.entrada.getData();
      if (dados.length > lim.imagemBytes) {
        throw new ErroHttp(400, `A imagem ${item.nome} passa de ${mb(lim.imagemBytes)}`);
      }
      real += dados.length;
      if (real > lim.totalBytes) {
        throw new ErroHttp(400, `O zip descomprimido passa de ${mb(lim.totalBytes)}`);
      }
      const [classe, arquivo] = item.caminho;
      const destino = path.join(pasta, classe, arquivo);
      await mkdir(path.dirname(destino), { recursive: true });
      await writeFile(destino, dados);
      amostras++;
    }
  } catch (erro) {
    rmSync(pasta, { recursive: true, force: true });
    throw erro;
  }

  return { classes, amostras };
}

export interface ResumoConversas {
  amostras: number;
  texto: string; // JSONL normalizado (sem linhas em branco), pronto para gravar
}

// Valida um JSONL de conversas: cada linha {"messages":[...]} com ≥1 user, ≥1 assistant e
// última mensagem assistant. Mínimo de 10 conversas. Erros citam o número da linha.
export function validarConversas(texto: string): ResumoConversas {
  const semBom = texto.replace(/^﻿/, '');
  const linhas = semBom.split(/\r?\n/);
  const validas: string[] = [];

  linhas.forEach((bruta, indice) => {
    const numero = indice + 1;
    const linha = bruta.trim();
    if (linha === '') return;

    let objeto: unknown;
    try {
      objeto = JSON.parse(linha);
    } catch {
      throw new ErroHttp(400, `Linha ${numero}: não é JSON válido`);
    }
    const mensagens = (objeto as { messages?: unknown })?.messages;
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      throw new ErroHttp(400, `Linha ${numero}: falta a lista "messages"`);
    }
    for (const m of mensagens as { role?: unknown; content?: unknown }[]) {
      if (typeof m !== 'object' || m === null || !PAPEIS_VALIDOS.includes(String(m.role))) {
        throw new ErroHttp(400, `Linha ${numero}: papel de mensagem inválido (use system, user ou assistant)`);
      }
      if (typeof m.content !== 'string') {
        throw new ErroHttp(400, `Linha ${numero}: "content" deve ser texto`);
      }
    }
    const papeis = (mensagens as { role: string }[]).map((m) => m.role);
    if (!papeis.includes('user')) {
      throw new ErroHttp(400, `Linha ${numero}: a conversa precisa de ao menos uma mensagem "user"`);
    }
    if (!papeis.includes('assistant')) {
      throw new ErroHttp(400, `Linha ${numero}: a conversa precisa de ao menos uma mensagem "assistant"`);
    }
    if (papeis[papeis.length - 1] !== 'assistant') {
      throw new ErroHttp(400, `Linha ${numero}: a última mensagem da conversa deve ser "assistant"`);
    }
    validas.push(linha);
  });

  if (validas.length < MINIMO_CONVERSAS) {
    throw new ErroHttp(
      400,
      `O arquivo precisa de pelo menos ${MINIMO_CONVERSAS} conversas (exigência da OpenAI); tem ${validas.length}.`
    );
  }
  return { amostras: validas.length, texto: validas.join('\n') + '\n' };
}

// Grava o JSONL normalizado em /data/datasets/<id>.jsonl; devolve o caminho relativo a /data.
export async function salvarConversas(id: number, texto: string): Promise<string> {
  const caminhoArquivo = `datasets/${id}.jsonl`;
  await writeFile(caminhoDados(caminhoArquivo), texto, 'utf8');
  return caminhoArquivo;
}

// Lista as imagens de uma classe do dataset de imagens (nomes relativos à pasta do dataset).
export async function listarImagens(pastaDataset: string): Promise<{ nome: string; quantidade: number; exemplos: string[] }[]> {
  const entradas = await readdir(pastaDataset, { withFileTypes: true }).catch(() => []);
  const classes = entradas.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX');
  const saida: { nome: string; quantidade: number; exemplos: string[] }[] = [];
  for (const classe of classes.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const arquivos = (await readdir(path.join(pastaDataset, classe.name), { withFileTypes: true }).catch(() => []))
      .filter((a) => a.isFile() && !a.name.startsWith('.') && ehImagem(a.name))
      .map((a) => a.name)
      .sort();
    saida.push({
      nome: classe.name,
      quantidade: arquivos.length,
      exemplos: arquivos.slice(0, 4).map((arquivo) => `${classe.name}/${arquivo}`),
    });
  }
  return saida;
}
