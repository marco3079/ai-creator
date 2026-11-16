// Diff por linhas (algoritmo de Myers, sem dependências), usado no histórico do projeto (B06).

export type TipoDiff = 'igual' | 'mais' | 'menos';

// Bloco do diff. Blocos 'igual' trazem só o contexto; as linhas iguais que ficaram de fora
// aparecem como bloco de "lacuna": linhas vazias e `ocultas` com a quantidade omitida.
export interface BlocoDiff {
  tipo: TipoDiff;
  linhas: string[];
  ocultas?: number;
}

export interface ArquivoTexto {
  caminho: string;
  conteudo: string;
}

export type SituacaoArquivo = 'adicionado' | 'removido' | 'modificado' | 'igual';

export interface ArquivoComparado {
  caminho: string;
  situacao: SituacaoArquivo;
}

interface Operacao {
  tipo: TipoDiff;
  linha: string;
}

function dividirLinhas(texto: string): string[] {
  return texto.split(/\r?\n/);
}

// Limites de custo: acima deles, o diff vira "tudo removido e tudo adicionado" (não trava a aba).
const MAX_CELULAS = 4_000_000;
const MAX_DISTANCIA = 2000;

// Diff trivial: todas as linhas de a saem ('menos') e todas as de b entram ('mais').
function operacoesTriviais(a: string[], b: string[]): Operacao[] {
  return [
    ...a.map((linha): Operacao => ({ tipo: 'menos', linha })),
    ...b.map((linha): Operacao => ({ tipo: 'mais', linha })),
  ];
}

// Myers: menor sequência de inserções/remoções que leva de a para b.
function operacoes(a: string[], b: string[]): Operacao[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELULAS) return operacoesTriviais(a, b);
  const maximo = n + m;
  const deslocamento = maximo + 1;
  const v = new Int32Array(2 * maximo + 3);
  // Cópia de v (faixa de k em [-d-1, d+1]) no início de cada passo d, para o retorno.
  const historico: Int32Array[] = [];
  let fim = -1;

  passos: for (let d = 0; d <= maximo; d++) {
    if (d > MAX_DISTANCIA) return operacoesTriviais(a, b);
    historico.push(v.slice(deslocamento - d - 1, deslocamento + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[deslocamento + k - 1] < v[deslocamento + k + 1])
          ? v[deslocamento + k + 1]
          : v[deslocamento + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[deslocamento + k] = x;
      if (x >= n && y >= m) {
        fim = d;
        break passos;
      }
    }
  }

  const ops: Operacao[] = [];
  let x = n;
  let y = m;
  for (let d = fim; d >= 0; d--) {
    const snapshot = historico[d];
    const ler = (k: number): number => snapshot[k + d + 1];
    const k = x - y;
    const kAnterior =
      k === -d || (k !== d && ler(k - 1) < ler(k + 1)) ? k + 1 : k - 1;
    const xAnterior = ler(kAnterior);
    const yAnterior = xAnterior - kAnterior;

    while (x > xAnterior && y > yAnterior) {
      ops.push({ tipo: 'igual', linha: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === xAnterior) {
        ops.push({ tipo: 'mais', linha: b[yAnterior] });
      } else {
        ops.push({ tipo: 'menos', linha: a[xAnterior] });
      }
    }
    x = xAnterior;
    y = yAnterior;
  }
  return ops.reverse();
}

// Diff entre o texto anterior e o atual, com `contexto` linhas iguais ao redor de cada mudança.
export function diffLinhas(anterior: string, atual: string, contexto = 3): BlocoDiff[] {
  const ops = operacoes(dividirLinhas(anterior), dividirLinhas(atual));

  const grupos: BlocoDiff[] = [];
  for (const op of ops) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.tipo === op.tipo) {
      ultimo.linhas.push(op.linha);
    } else {
      grupos.push({ tipo: op.tipo, linhas: [op.linha] });
    }
  }

  const resultado: BlocoDiff[] = [];
  grupos.forEach((grupo, indice) => {
    if (grupo.tipo !== 'igual') {
      resultado.push(grupo);
      return;
    }
    const primeiro = indice === 0;
    const ultimo = indice === grupos.length - 1;
    const linhas = grupo.linhas;
    const n = linhas.length;

    if (primeiro && ultimo) {
      resultado.push(grupo);
    } else if (primeiro) {
      if (n > contexto) {
        resultado.push({ tipo: 'igual', linhas: [], ocultas: n - contexto });
      }
      resultado.push({ tipo: 'igual', linhas: linhas.slice(-contexto) });
    } else if (ultimo) {
      resultado.push({ tipo: 'igual', linhas: linhas.slice(0, contexto) });
      if (n > contexto) {
        resultado.push({ tipo: 'igual', linhas: [], ocultas: n - contexto });
      }
    } else if (n > 2 * contexto) {
      resultado.push({ tipo: 'igual', linhas: linhas.slice(0, contexto) });
      resultado.push({ tipo: 'igual', linhas: [], ocultas: n - 2 * contexto });
      resultado.push({ tipo: 'igual', linhas: linhas.slice(-contexto) });
    } else {
      resultado.push(grupo);
    }
  });
  return resultado;
}

// Compara a lista de arquivos de duas versões (ou da versão com os atuais).
// Ordena por caminho. `anteriores` é a base; `atuais` o alvo.
export function compararArquivos(anteriores: ArquivoTexto[], atuais: ArquivoTexto[]): ArquivoComparado[] {
  const antigos = new Map(anteriores.map((a) => [a.caminho, a.conteudo]));
  const novos = new Map(atuais.map((a) => [a.caminho, a.conteudo]));
  const caminhos = [...new Set([...antigos.keys(), ...novos.keys()])].sort();

  return caminhos.map((caminho) => {
    const antes = antigos.get(caminho);
    const depois = novos.get(caminho);
    let situacao: SituacaoArquivo;
    if (antes === undefined) situacao = 'adicionado';
    else if (depois === undefined) situacao = 'removido';
    else if (antes !== depois) situacao = 'modificado';
    else situacao = 'igual';
    return { caminho, situacao };
  });
}
