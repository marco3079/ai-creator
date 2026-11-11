import { ErroHttp } from '../../lib/erros';

export const LIMITE_CSV_BYTES = 20 * 1024 * 1024;

export interface ResumoCsv {
  cabecalho: string[];
  classes: string[];
  amostras: number;
  colunas: number;
}

interface LinhaCsv {
  numero: number; // número físico da linha no arquivo (1 = cabeçalho)
  campos: string[];
}

// Interpreta CSV com "," como separador e campos entre aspas ("" = aspas literal).
// Linhas em branco são ignoradas, mas mantêm a numeração física.
export function interpretarCsv(texto: string): LinhaCsv[] {
  const s = texto.replace(/^﻿/, '');
  const linhas: LinhaCsv[] = [];
  let campos: string[] = [];
  let campo = '';
  let entreAspas = false;
  let numero = 1;
  let inicioLinha = 1;

  const fecharLinha = () => {
    campos.push(campo);
    const vazia = campos.length === 1 && campo.trim() === '';
    if (!vazia) linhas.push({ numero: inicioLinha, campos });
    campos = [];
    campo = '';
    numero++;
    inicioLinha = numero;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (entreAspas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        if (c === '\n') numero++;
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ',') {
      campos.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fecharLinha();
    } else {
      campo += c;
    }
  }
  if (campo !== '' || campos.length > 0) fecharLinha();

  return linhas;
}

// Valida o CSV de um dataset: cabeçalho "rotulo,<atributos...>", mesmo nº de colunas em
// todas as linhas, atributos numéricos e rótulos não vazios. Erros citam o número da linha.
export function analisarCsv(texto: string): ResumoCsv {
  if (Buffer.byteLength(texto, 'utf8') > LIMITE_CSV_BYTES) {
    throw new ErroHttp(413, 'CSV excede o limite de 20 MB');
  }

  const linhas = interpretarCsv(texto);
  if (linhas.length === 0) throw new ErroHttp(400, 'CSV vazio');

  const [cabecalhoLinha, ...dados] = linhas;
  const cabecalho = cabecalhoLinha.campos;
  if (cabecalho[0] !== 'rotulo') {
    throw new ErroHttp(400, 'Linha 1: o cabeçalho deve começar com a coluna "rotulo"');
  }
  if (cabecalho.length < 2) {
    throw new ErroHttp(400, 'Linha 1: o CSV precisa de pelo menos uma coluna de atributo');
  }
  if (dados.length === 0) throw new ErroHttp(400, 'CSV sem amostras');

  const classes = new Set<string>();
  for (const { numero, campos } of dados) {
    if (campos.length !== cabecalho.length) {
      throw new ErroHttp(
        400,
        `Linha ${numero}: esperadas ${cabecalho.length} colunas, encontradas ${campos.length}`,
      );
    }
    const rotulo = campos[0];
    if (rotulo.trim() === '') throw new ErroHttp(400, `Linha ${numero}: rótulo vazio`);
    classes.add(rotulo);

    for (let j = 1; j < campos.length; j++) {
      const valor = campos[j].trim();
      if (valor === '' || !Number.isFinite(Number(valor))) {
        throw new ErroHttp(
          400,
          `Linha ${numero}, coluna "${cabecalho[j]}": valor não numérico "${campos[j]}"`,
        );
      }
    }
  }

  // Rótulo numérico com muitos valores distintos é alvo de regressão, não classe: não lista "classes".
  const LIMITE_CLASSES = 50;
  const todosNumericos = [...classes].every((c) => c.trim() !== '' && Number.isFinite(Number(c)));
  const ehRegressao = todosNumericos && classes.size > LIMITE_CLASSES;

  return {
    cabecalho,
    classes: ehRegressao ? [] : [...classes].sort(),
    amostras: dados.length,
    colunas: cabecalho.length - 1,
  };
}
