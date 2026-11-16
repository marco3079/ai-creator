// Tipos das melhorias da leva A (fonte: docs/plano/CONTRATOS-MELHORIAS.md). Escrito pelo main; os geradores só importam.
import type { StatusJob } from './tipos-api';

// ---------- Eventos ao vivo (GET /api/eventos, SSE) ----------

export type TipoTrabalho = 'treino' | 'treinoModelo' | 'build';

export interface EventoTrabalho {
  tipo: TipoTrabalho;
  id: number;
  status: StatusJob;
  agenteId?: number | null; // treino (agente TinyML)
  modeloId?: number | null; // treinoModelo
  projetoId?: number | null; // build
  em: string; // ISO
}

// ---------- Testar modelo (POST /api/treinos-modelo/:id/prever) ----------

export interface PedidoPrevisao {
  valores?: number[]; // CLASSIFICACAO / REGRESSAO (TINYML e TABULAR): uma linha de atributos, na ordem do CSV
  imagemBase64?: string; // IMAGEM: arquivo de imagem em base64 (sem o prefixo data:)
  audioBase64?: string; // AUDIO: arquivo .wav em base64
}

export interface ResultadoPrevisao {
  classe?: string; // classificação
  probabilidades?: { classe: string; valor: number }[]; // ordenadas da maior para a menor
  valor?: number; // regressão (já na escala original)
  saidaBruta: number[]; // saída do modelo após desquantizar
  latenciaMs: number; // tempo de inferência no servidor (não é o tempo na placa)
  avisos: string[];
}

// ---------- Uso de LLM (GET /api/uso/resumo) ----------

export interface ResumoUso {
  dias: number;
  totalUsd: number; // soma dos custos conhecidos
  semPreco: number; // execuções de modelos sem preço cadastrado
  execucoes: number;
  entrada: number;
  saida: number;
  porDia: { dia: string; custoUsd: number; entrada: number; saida: number; execucoes: number }[]; // todos os dias do período
  porAgente: { agenteId: number | null; nome: string; execucoes: number; entrada: number; saida: number; custoUsd: number }[];
  porModelo: { modelo: string; provedor: string; execucoes: number; entrada: number; saida: number; custoUsd: number | null }[];
}

export type PrecosLlm = Record<string, { entrada: number; saida: number }>; // USD por 1M tokens

// ---------- Agente com ferramentas da plataforma ----------

// Nomes que entram em Agente.ferramentas para ligar as ferramentas da plataforma (precisa de projeto vinculado).
export const FERRAMENTAS_PLATAFORMA = [
  { nome: 'aic.listar_arquivos', rotulo: 'Listar arquivos do projeto' },
  { nome: 'aic.ler_arquivo', rotulo: 'Ler arquivo' },
  { nome: 'aic.escrever_arquivo', rotulo: 'Escrever arquivo' },
  { nome: 'aic.compilar', rotulo: 'Compilar o projeto' },
] as const;

// Eventos extras do SSE de POST /agentes/:id/executar (além de texto/fim/erro).
export type EventoExecucao =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ferramenta'; id: string; nome: string; entrada: string; fase: 'inicio' }
  | { tipo: 'ferramenta'; id: string; nome: string; resultado: string; erro: boolean; fase: 'fim' }
  | { tipo: 'fim'; uso: { entrada: number; saida: number; custoUsd: number | null } }
  | { tipo: 'erro'; erro: string };

// ---------- Coleta de dados pela serial ----------

// Linha de dados: números separados por vírgula. Linhas que começam com '#' são metadados,
// ex.: "# AIC-COLETA canais=3 hz=50 nomes=ax,ay,az".
export interface MetadadosColeta {
  canais: number;
  hz: number;
  nomes: string[];
}
