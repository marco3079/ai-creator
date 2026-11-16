// Ferramentas da plataforma que um agente LLM pode chamar (nomes "aic.*" em Agente.ferramentas).
// Só ligam com projeto vinculado. Contratos: CONTRATOS-MELHORIAS.md §8.
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { registrar } from '../../lib/log';
import { ouvirEventos } from '../../lib/eventos';
import { criarBuild } from '../projetos/build';
import { validarCaminho } from '../projetos/caminhos';
import type { Agente } from '../agentes/padroes';
import type { DefinicaoFerramenta, ResultadoFerramenta } from './provedores/ferramentas-tipos';

const PREFIXO = 'aic.';
const LIMITE_LEITURA = 20000; // caracteres devolvidos ao modelo
const LIMITE_ESCRITA_BYTES = 200 * 1024;
const LIMITE_ESPERA_BUILD_MS = 10 * 60 * 1000;
const INTERVALO_CONSULTA_BUILD_MS = 5000;
const LINHAS_LOG_BUILD = 80;
const STATUS_FINAIS = ['SUCESSO', 'FALHA', 'CANCELADO'];

const SemEntrada = z.object({});
const CaminhoEntrada = z.object({
  caminho: z.string().min(1, 'Informe o caminho do arquivo').max(200, 'Caminho muito longo'),
});
const EscreverEntrada = z.object({
  caminho: z.string().min(1, 'Informe o caminho do arquivo').max(200, 'Caminho muito longo'),
  conteudo: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') <= LIMITE_ESCRITA_BYTES, 'Conteúdo maior que 200 KB'),
});

// Todas as definições disponíveis, na ordem em que o modelo as vê.
const DEFINICOES: DefinicaoFerramenta[] = [
  {
    nome: 'listar_arquivos',
    descricao: 'Lista os caminhos dos arquivos do projeto vinculado ao agente (relativos à raiz do projeto).',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    validar: SemEntrada,
  },
  {
    nome: 'ler_arquivo',
    descricao: 'Lê o conteúdo de um arquivo do projeto. Conteúdos muito grandes são cortados.',
    esquema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo à raiz do projeto, com "/" (ex.: src/main.cpp)' },
      },
      required: ['caminho'],
      additionalProperties: false,
    },
    validar: CaminhoEntrada,
  },
  {
    nome: 'escrever_arquivo',
    descricao:
      'Cria ou substitui um arquivo do projeto com o conteúdo informado. O conteúdo completo é gravado (não é um trecho). Máximo de 200 KB.',
    esquema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho relativo à raiz do projeto, com "/" (ex.: src/main.cpp)' },
        conteudo: { type: 'string', description: 'Conteúdo completo do arquivo' },
      },
      required: ['caminho', 'conteudo'],
      additionalProperties: false,
    },
    validar: EscreverEntrada,
  },
  {
    nome: 'compilar',
    descricao:
      'Compila o projeto (PlatformIO, na placa do projeto) e devolve o status, o tamanho do firmware e as últimas linhas do log.',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    validar: SemEntrada,
  },
];

// Definições liberadas para o agente. Vazio se não há projeto vinculado ou nenhum "aic.*" marcado.
export function ferramentasDoAgente(agente: Pick<Agente, 'ferramentas' | 'projetoId'>): DefinicaoFerramenta[] {
  if (agente.projetoId == null) return [];
  const marcadas = new Set(
    agente.ferramentas.filter((f) => f.startsWith(PREFIXO)).map((f) => f.slice(PREFIXO.length)),
  );
  return DEFINICOES.filter((d) => marcadas.has(d.nome));
}

function cortar(texto: string): string {
  return texto.length > LIMITE_LEITURA ? `${texto.slice(0, LIMITE_LEITURA)}\n[… conteúdo cortado]` : texto;
}

function falha(mensagem: string): ResultadoFerramenta {
  return { conteudo: mensagem, erro: true };
}

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

// Espera de uma execução: acorda com o próximo evento de build ou depois de um tempo (o que vier antes).
function criarEspera() {
  let acordar: (() => void) | null = null;
  return {
    aoEvento: () => {
      acordar?.();
      acordar = null;
    },
    esperar: (ms: number) =>
      new Promise<void>((resolver) => {
        const relogio = setTimeout(() => {
          acordar = null;
          resolver();
        }, ms);
        acordar = () => {
          clearTimeout(relogio);
          resolver();
        };
      }),
  };
}

// Espera o fim do build: usa os eventos ao vivo e, por segurança, consulta o banco a cada 5 s.
// Devolve o status final, ou null se passar do limite de 10 min.
async function aguardarBuild(
  buildId: number,
  finais: Map<number, string>,
  espera: ReturnType<typeof criarEspera>,
): Promise<string | null> {
  const inicio = Date.now();
  while (Date.now() - inicio < LIMITE_ESPERA_BUILD_MS) {
    const emMemoria = finais.get(buildId);
    if (emMemoria) return emMemoria;
    await espera.esperar(INTERVALO_CONSULTA_BUILD_MS);
    const atual = await prisma.build.findUnique({ where: { id: buildId }, select: { status: true } });
    if (atual && STATUS_FINAIS.includes(atual.status)) return atual.status;
  }
  return null;
}

// Executor das ferramentas para um projeto e um usuário. Nunca lança: falhas voltam como resultado de erro.
export function criarExecutorFerramentas(
  projetoId: number,
  usuarioId: number,
): (nome: string, entrada: unknown) => Promise<ResultadoFerramenta> {
  return async (nome, entrada) => {
    try {
      switch (nome) {
        case 'listar_arquivos': {
          const arquivos = await prisma.arquivoProjeto.findMany({
            where: { projetoId },
            select: { caminho: true },
            orderBy: { caminho: 'asc' },
          });
          if (arquivos.length === 0) return { conteudo: 'O projeto não tem arquivos.' };
          return { conteudo: arquivos.map((a) => a.caminho).join('\n') };
        }

        case 'ler_arquivo': {
          const { caminho: bruto } = entrada as { caminho: string };
          const caminho = validarCaminho(bruto);
          const arquivo = await prisma.arquivoProjeto.findUnique({
            where: { projetoId_caminho: { projetoId, caminho } },
          });
          if (!arquivo) return falha(`Arquivo não encontrado: ${caminho}`);
          return { conteudo: cortar(arquivo.conteudo) };
        }

        case 'escrever_arquivo': {
          const { caminho: bruto, conteudo } = entrada as { caminho: string; conteudo: string };
          const caminho = validarCaminho(bruto);
          await prisma.arquivoProjeto.upsert({
            where: { projetoId_caminho: { projetoId, caminho } },
            update: { conteudo },
            create: { projetoId, caminho, conteudo },
          });
          await registrar(usuarioId, 'agente.escrever-arquivo', `projeto #${projetoId}: ${caminho}`);
          return { conteudo: `Arquivo gravado: ${caminho} (${Buffer.byteLength(conteudo, 'utf8')} bytes).` };
        }

        case 'compilar': {
          const finais = new Map<number, string>();
          const espera = criarEspera();
          // Assina antes de criar o build, para não perder o evento final.
          const parar = ouvirEventos((e) => {
            if (e.tipo === 'build' && STATUS_FINAIS.includes(e.status)) finais.set(e.id, e.status);
            espera.aoEvento();
          });
          try {
            const build = await criarBuild(projetoId, {}, usuarioId);
            const status = await aguardarBuild(build.id, finais, espera);
            if (status === null) {
              return falha(
                `A compilação #${build.id} não terminou em 10 minutos. Veja o andamento no painel de builds.`,
              );
            }
            const atual = await prisma.build.findUnique({ where: { id: build.id } });
            const linhas = (atual?.log ?? '').split('\n');
            const ultimas = linhas.slice(-LINHAS_LOG_BUILD).join('\n');
            const resumo = [
              `Compilação #${build.id}: ${status}`,
              `Tamanho do firmware: ${atual?.tamanhoBytes ?? 'desconhecido'} bytes`,
              '',
              `Últimas ${LINHAS_LOG_BUILD} linhas do log:`,
              ultimas,
            ].join('\n');
            return { conteudo: cortar(resumo), erro: status !== 'SUCESSO' };
          } finally {
            parar();
          }
        }

        default:
          return falha(`Ferramenta desconhecida: ${nome}`);
      }
    } catch (e) {
      return falha(mensagemDeErro(e, 'Erro ao executar a ferramenta.'));
    }
  };
}
