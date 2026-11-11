#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/** Endereço base do AI Creator. As chamadas vão para `<url>/api/...`. */
const URL_BASE = (process.env.AI_CREATOR_URL?.trim() || 'http://localhost:8080').replace(/\/+$/, '');
/** Token de API (`aic_...`) gerado em "Tokens de API" no AI Creator. */
const TOKEN = process.env.AI_CREATOR_TOKEN?.trim();

if (!TOKEN) {
  process.stderr.write(
    '[ai-creator-mcp] A variável AI_CREATOR_TOKEN não está definida. ' +
      'Crie um token em "Tokens de API" no AI Creator e defina AI_CREATOR_TOKEN.\n',
  );
  process.exit(1);
}

const TERMINAIS = new Set(['SUCESSO', 'FALHA', 'CANCELADO']);
const LINHAS_DE_LOG = 80;
const INTERVALO_POLLING_MS = 3_000;

class ErroApi extends Error {}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Chamada HTTP à API do AI Creator. Devolve JSON, texto, ou `null` para 204. */
async function api(
  metodo: string,
  caminho: string,
  opcoes: { corpo?: unknown; tempoLimiteMs?: number } = {},
): Promise<unknown> {
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  if (opcoes.corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${URL_BASE}/api${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(opcoes.tempoLimiteMs ?? 30_000),
    });
  } catch (erro) {
    throw new ErroApi(`Não foi possível conectar em ${URL_BASE} (${mensagemDe(erro)}).`);
  }

  if (!resposta.ok) {
    let mensagem = `Erro HTTP ${resposta.status}`;
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados?.erro) {
        mensagem = dados.erro;
      }
    } catch {
      // corpo não é JSON; mantém a mensagem padrão
    }
    throw new ErroApi(mensagem);
  }

  if (resposta.status === 204) {
    return null;
  }
  const tipo = resposta.headers.get('content-type') ?? '';
  return tipo.includes('application/json') ? resposta.json() : resposta.text();
}

type Resultado = { content: { type: 'text'; text: string }[]; isError?: boolean };

function sucesso(dados: unknown): Resultado {
  const texto = typeof dados === 'string' ? dados : JSON.stringify(dados ?? { ok: true }, null, 2);
  return { content: [{ type: 'text', text: texto }] };
}

function falha(erro: unknown): Resultado {
  return { content: [{ type: 'text', text: `Erro: ${mensagemDe(erro)}` }], isError: true };
}

/** Executa a operação e converte o resultado (ou o erro) no formato de ferramenta MCP. */
async function ferramenta(operacao: () => Promise<unknown>): Promise<Resultado> {
  try {
    return sucesso(await operacao());
  } catch (erro) {
    return falha(erro);
  }
}

function ultimasLinhas(log: string | undefined): string | undefined {
  if (log === undefined) {
    return undefined;
  }
  return log.split('\n').slice(-LINHAS_DE_LOG).join('\n');
}

/** Troca o campo `log` (que pode ser grande) pelas últimas linhas. */
function resumirLog(objeto: unknown): unknown {
  if (!objeto || typeof objeto !== 'object') {
    return objeto;
  }
  const { log, ...resto } = objeto as Record<string, unknown>;
  return { ...resto, logUltimasLinhas: ultimasLinhas(typeof log === 'string' ? log : undefined) };
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Aceita id numérico ou slug e devolve sempre o id numérico do projeto. */
async function idProjeto(referencia: string | number): Promise<number> {
  const projeto = (await api('GET', `/projetos/${encodeURIComponent(String(referencia))}`)) as { id: number };
  return projeto.id;
}

const referenciaAgente = z.union([z.number().int(), z.string()]).describe('id numérico ou slug do agente');
const referenciaProjeto = z.union([z.number().int(), z.string()]).describe('id numérico ou slug do projeto');

const servidor = new McpServer({ name: 'ai-creator', version: '0.1.0' });

// ---------------------------------------------------------------- agentes

servidor.registerTool(
  'listar_agentes',
  {
    description: 'Lista os agentes do AI Creator (LLM e TinyML). Aceita filtro por tipo e busca por texto.',
    inputSchema: {
      tipo: z.enum(['LLM', 'TINYML']).optional().describe('Tipo de agente'),
      busca: z.string().optional().describe('Texto para buscar no nome ou na descrição'),
    },
  },
  ({ tipo, busca }) =>
    ferramenta(() => {
      const params = new URLSearchParams();
      if (tipo) {
        params.set('tipo', tipo);
      }
      if (busca) {
        params.set('busca', busca);
      }
      const consulta = params.toString();
      return api('GET', `/agentes${consulta ? `?${consulta}` : ''}`);
    }),
);

servidor.registerTool(
  'ler_agente',
  {
    description: 'Lê um agente completo (prompt, parâmetros, configuração TinyML).',
    inputSchema: { id: referenciaAgente },
  },
  ({ id }) => ferramenta(() => api('GET', `/agentes/${encodeURIComponent(String(id))}`)),
);

servidor.registerTool(
  'salvar_agente',
  {
    description:
      'Cria um agente (sem id) ou atualiza um existente (com id). "dados" tem os campos do agente, ex.: nome, tipo, promptSistema, modelo.',
    inputSchema: {
      id: z.number().int().optional().describe('id do agente a atualizar; omitir para criar'),
      dados: z.record(z.string(), z.unknown()).describe('Campos do agente'),
    },
  },
  ({ id, dados }) =>
    ferramenta(() =>
      id === undefined
        ? api('POST', '/agentes', { corpo: dados })
        : api('PUT', `/agentes/${id}`, { corpo: dados }),
    ),
);

servidor.registerTool(
  'exportar_agente_md',
  {
    description: 'Exporta um agente LLM no formato de subagente do Claude Code (Markdown com frontmatter).',
    inputSchema: { id: referenciaAgente },
  },
  ({ id }) =>
    ferramenta(() => api('GET', `/agentes/${encodeURIComponent(String(id))}/exportar?formato=md`)),
);

servidor.registerTool(
  'importar_agente_md',
  {
    description:
      'Importa um subagente do Claude Code (conteúdo Markdown com frontmatter). Se o slug já existir, o agente é atualizado.',
    inputSchema: { conteudo: z.string().describe('Conteúdo completo do arquivo .md') },
  },
  ({ conteudo }) =>
    ferramenta(() => api('POST', '/agentes/importar', { corpo: { conteudo, formato: 'md' } })),
);

// ---------------------------------------------------------------- projetos

servidor.registerTool(
  'listar_projetos',
  {
    description: 'Lista os projetos de firmware (nome, slug, placa e último build).',
    inputSchema: {},
  },
  () => ferramenta(() => api('GET', '/projetos')),
);

servidor.registerTool(
  'listar_arquivos',
  {
    description: 'Lista os arquivos de um projeto (caminho e data de atualização, sem conteúdo).',
    inputSchema: { projeto: referenciaProjeto },
  },
  ({ projeto }) => ferramenta(async () => api('GET', `/projetos/${await idProjeto(projeto)}/arquivos`)),
);

servidor.registerTool(
  'ler_arquivo',
  {
    description: 'Lê o conteúdo de um arquivo de um projeto.',
    inputSchema: {
      projeto: referenciaProjeto,
      caminho: z.string().describe('Caminho relativo dentro do projeto, ex.: src/main.cpp'),
    },
  },
  ({ projeto, caminho }) =>
    ferramenta(async () =>
      api('GET', `/projetos/${await idProjeto(projeto)}/arquivo?caminho=${encodeURIComponent(caminho)}`),
    ),
);

servidor.registerTool(
  'escrever_arquivo',
  {
    description: 'Cria ou substitui um arquivo de um projeto.',
    inputSchema: {
      projeto: referenciaProjeto,
      caminho: z.string().describe('Caminho relativo dentro do projeto, ex.: src/main.cpp'),
      conteudo: z.string().describe('Conteúdo completo do arquivo'),
    },
  },
  ({ projeto, caminho, conteudo }) =>
    ferramenta(async () => {
      const id = await idProjeto(projeto);
      await api('PUT', `/projetos/${id}/arquivo`, { corpo: { caminho, conteudo } });
      return `Arquivo "${caminho}" gravado no projeto ${id}.`;
    }),
);

servidor.registerTool(
  'compilar_projeto',
  {
    description:
      'Compila um projeto no servidor. Acompanha o build por até "aguardarSegundos" e devolve o status e as últimas 80 linhas do log. Se ainda não terminou, use status_build.',
    inputSchema: {
      projeto: referenciaProjeto,
      agenteId: z.number().int().optional().describe('Agente TinyML cujo modelo treinado entra no firmware'),
      aguardarSegundos: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .optional()
        .default(300)
        .describe('Tempo máximo de espera pelo fim do build (padrão 300)'),
    },
  },
  ({ projeto, agenteId, aguardarSegundos }) =>
    ferramenta(async () => {
      const id = await idProjeto(projeto);
      const corpo = agenteId === undefined ? {} : { agenteId };
      const build = (await api('POST', `/projetos/${id}/build`, { corpo })) as { id: number; status: string };
      const limite = Date.now() + (aguardarSegundos ?? 300) * 1000;

      let atual = (await api('GET', `/builds/${build.id}`)) as { id: number; status: string; log?: string };
      while (!TERMINAIS.has(atual.status) && Date.now() < limite) {
        await dormir(INTERVALO_POLLING_MS);
        atual = (await api('GET', `/builds/${build.id}`)) as typeof atual;
      }
      return {
        buildId: atual.id,
        status: atual.status,
        concluido: TERMINAIS.has(atual.status),
        logUltimasLinhas: ultimasLinhas(atual.log),
      };
    }),
);

servidor.registerTool(
  'status_build',
  {
    description: 'Mostra o status de um build e as últimas 80 linhas do log.',
    inputSchema: { id: z.number().int().describe('id do build') },
  },
  ({ id }) => ferramenta(async () => resumirLog(await api('GET', `/builds/${id}`))),
);

// ---------------------------------------------------------------- TinyML

servidor.registerTool(
  'listar_datasets',
  {
    description: 'Lista os datasets de treino (id, nome, tipo, classes, amostras).',
    inputSchema: {},
  },
  () => ferramenta(() => api('GET', '/datasets')),
);

servidor.registerTool(
  'treinar_agente',
  {
    description: 'Inicia o treino de um agente TinyML com um dataset. Devolve o treino em fila.',
    inputSchema: {
      id: z.number().int().describe('id do agente TinyML'),
      datasetId: z.number().int().describe('id do dataset'),
      parametros: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Ajustes da configuração TinyML (ex.: epocas, neuronios, arquitetura)'),
    },
  },
  ({ id, datasetId, parametros }) =>
    ferramenta(() => api('POST', `/agentes/${id}/treinar`, { corpo: { datasetId, parametros } })),
);

servidor.registerTool(
  'status_treino',
  {
    description: 'Mostra o status e as métricas de um treino, com as últimas 80 linhas do log.',
    inputSchema: { id: z.number().int().describe('id do treino') },
  },
  ({ id }) => ferramenta(async () => resumirLog(await api('GET', `/treinos/${id}`))),
);

async function main(): Promise<void> {
  await servidor.connect(new StdioServerTransport());
}

main().catch((erro) => {
  process.stderr.write(`[ai-creator-mcp] Falha ao iniciar: ${mensagemDe(erro)}\n`);
  process.exit(1);
});
