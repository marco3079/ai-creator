import { ErroHttp } from '../../lib/erros';
import type { Agente } from './padroes';
import type { AgenteEntrada } from './esquemas';

// Formato de subagente do Claude Code: frontmatter YAML simples + prompt do sistema no corpo.
// Mapeamento de modelo (contrato §3):
//   exportar: modelo contém "opus"/"sonnet"/"haiku" -> opus/sonnet/haiku; senão inherit.
//   importar: opus/sonnet/haiku -> claude-*-5-5; inherit ou ausente -> claude-opus-5-5.

const MODELO_POR_NOME: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

function nomeDoModelo(modelo: string | null): 'opus' | 'sonnet' | 'haiku' | 'inherit' {
  const m = (modelo ?? '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'inherit';
}

export function paraMarkdown(a: Agente): string {
  const descricao = a.descricao.replace(/\s+/g, ' ').trim();
  const linhas = [
    '---',
    `name: ${a.slug}`,
    `description: ${descricao}`,
    `model: ${nomeDoModelo(a.modelo)}`,
  ];
  if (a.ferramentas.length > 0) linhas.push(`tools: ${a.ferramentas.join(', ')}`);
  linhas.push('---', '', a.promptSistema ?? '');
  return linhas.join('\n') + '\n';
}

export function deMarkdown(texto: string): AgenteEntrada {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  if (linhas[0]?.trim() !== '---') {
    throw new ErroHttp(400, 'Arquivo .md sem cabeçalho (---) no início');
  }
  const fim = linhas.findIndex((linha, i) => i > 0 && linha.trim() === '---');
  if (fim < 0) throw new ErroHttp(400, 'Cabeçalho do .md não foi fechado com ---');

  const cabecalho: Record<string, string> = {};
  for (const linha of linhas.slice(1, fim)) {
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim();
    let valor = linha.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(valor)) valor = valor.slice(1, -1);
    cabecalho[chave] = valor;
  }

  const slug = cabecalho.name?.trim();
  if (!slug) throw new ErroHttp(400, 'Cabeçalho do .md sem o campo name');

  const nomeLegivel = slug.replace(/-/g, ' ');
  const nome = nomeLegivel.charAt(0).toUpperCase() + nomeLegivel.slice(1);

  const modeloNome = nomeDoModelo(cabecalho.model ?? null);
  const modelo = MODELO_POR_NOME[modeloNome] ?? MODELO_POR_NOME.opus;

  const ferramentas = (cabecalho.tools ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  return {
    nome,
    descricao: cabecalho.description ?? '',
    tipo: 'LLM',
    provedor: 'ANTHROPIC',
    modelo,
    promptSistema: linhas.slice(fim + 1).join('\n').trim(),
    ferramentas,
  };
}
