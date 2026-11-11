// Tipos da área "Modelos" (fonte: docs/plano/CONTRATOS-MODELOS.md). Escrito pelo main; os geradores só importam.
import type { Placa, StatusJob } from './tipos-api';

export type TipoModelo = 'TINYML' | 'TABULAR' | 'LLM_NUVEM' | 'LLM_LOCAL';
export type TarefaModelo = 'CLASSIFICACAO' | 'REGRESSAO' | 'IMAGEM' | 'CHAT';
export type TipoDataset = 'SERIE_TEMPORAL' | 'AUDIO' | 'TABELA' | 'IMAGENS' | 'CONVERSAS';

export const TIPOS_MODELO: { valor: TipoModelo; rotulo: string; descricao: string; tarefas: TarefaModelo[]; datasets: TipoDataset[] }[] = [
  {
    valor: 'TINYML',
    rotulo: 'TinyML (placa)',
    descricao: 'Rede neural pequena para microcontrolador. Exporta TFLite INT8 e model_data.h.',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO', 'IMAGEM'],
    datasets: ['SERIE_TEMPORAL', 'TABELA', 'AUDIO', 'IMAGENS'],
  },
  {
    valor: 'TABULAR',
    rotulo: 'Clássico (tabular)',
    descricao: 'scikit-learn sobre CSV. Exporta .joblib e, quando possível, código C para a placa.',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    datasets: ['SERIE_TEMPORAL', 'TABELA', 'AUDIO'],
  },
  {
    valor: 'LLM_NUVEM',
    rotulo: 'LLM — ajuste fino na nuvem',
    descricao: 'Ajuste fino pela API da OpenAI a partir de conversas (JSONL). Cobrado por uso.',
    tarefas: ['CHAT'],
    datasets: ['CONVERSAS'],
  },
  {
    valor: 'LLM_LOCAL',
    rotulo: 'LLM — ajuste fino local (GPU)',
    descricao: 'LoRA de um modelo aberto no serviço finetuner e registro no Ollama.',
    tarefas: ['CHAT'],
    datasets: ['CONVERSAS'],
  },
];

export const ROTULO_TAREFA: Record<TarefaModelo, string> = {
  CLASSIFICACAO: 'Classificação',
  REGRESSAO: 'Regressão',
  IMAGEM: 'Classificação de imagens',
  CHAT: 'Conversa (chat)',
};

// ---------- Configuração por tipo ----------

export interface ConfigModeloTinyml {
  entrada: {
    tipo: 'SERIE_TEMPORAL' | 'AUDIO' | 'TABELA' | 'IMAGENS';
    canais: number;
    janela: number;
    frequenciaHz: number;
    imagem: { largura: number; altura: number; cores: 1 | 3 };
  };
  arquitetura: 'DENSA' | 'CNN1D' | 'DS_CNN' | 'CNN2D';
  camadas: number; // 1..6
  neuronios: number; // 4..256
  epocas: number; // 1..500
  taxaAprendizado: number;
  tamanhoLote: number; // 8..256
  quantizacao: 'INT8' | 'FLOAT32';
  aumentoDados: boolean; // só IMAGEM: flip/rotação leve
  placaAlvo: Placa;
  limiteRamKb: number;
  limiteFlashKb: number;
}

export type AlgoritmoTabular = 'ARVORE' | 'RANDOM_FOREST' | 'GRADIENT_BOOSTING' | 'LOGISTICA' | 'LINEAR' | 'KNN' | 'SVM';

export interface ConfigModeloTabular {
  algoritmo: AlgoritmoTabular;
  hiperparametros: Record<string, number | string | boolean>;
  testeFracao: number; // 0.1..0.5
  validacaoCruzada: number; // 0 = desligada, 2..10 = k-fold
  normalizar: boolean;
  exportarC: boolean;
}

export interface ConfigModeloLlmNuvem {
  provedor: 'OPENAI';
  modeloBase: string;
  epocas: number | null; // null = automático
  tamanhoLote: number | null;
  multiplicadorTaxa: number | null;
  sufixo: string; // até 18 caracteres [a-z0-9-]
  promptSistema: string; // usado ao criar um agente com o modelo treinado
}

export interface ConfigModeloLlmLocal {
  modeloBase: 'llama3.2:1b' | 'llama3.2:3b';
  loraRank: number; // 4..64
  loraAlpha: number; // 8..128
  epocas: number; // 1..10
  taxaAprendizado: number;
  tamanhoLote: number; // 1..16
  comprimentoMax: number; // 256..4096
  nomeOllama: string; // vazio = "aic-<slug>-v<numero>"
  promptSistema: string;
}

export type ConfigModelo = ConfigModeloTinyml | ConfigModeloTabular | ConfigModeloLlmNuvem | ConfigModeloLlmLocal;

// ---------- Entidades ----------

export type TipoArtefato = 'TFLITE' | 'HEADER_C' | 'JOBLIB' | 'ADAPTER' | 'METRICAS' | 'OUTRO';

export interface Artefato {
  nome: string; // nome do arquivo (ex.: "model_data.h")
  tipo: TipoArtefato;
  caminho: string; // relativo a /data
  tamanhoBytes: number;
}

export interface MetricaPrincipal {
  nome: string; // "acuracia", "acuraciaValidacao", "r2", "perdaValidacao"...
  rotulo: string; // "Acurácia (val.)"
  valor: number;
  formato: 'percentual' | 'numero';
}

export interface MetricasModelo {
  principal?: MetricaPrincipal;
  // classificação
  acuracia?: number;
  acuraciaValidacao?: number;
  f1?: number;
  precisao?: number;
  recall?: number;
  matrizConfusao?: number[][];
  classes?: string[];
  // regressão
  mae?: number;
  rmse?: number;
  r2?: number;
  // redes e LLM
  perda?: number;
  perdaValidacao?: number;
  historico?: { epoca: number; perda: number; perdaValidacao?: number; metrica?: number; metricaValidacao?: number }[];
  validacaoCruzada?: { media: number; desvio: number; k: number };
  tokensTreinados?: number;
  [chave: string]: unknown;
}

export interface TreinoModeloResumo {
  id: number;
  modeloId: number;
  numero: number;
  status: StatusJob;
  datasetId: number | null;
  metricas: MetricasModelo | null;
  modeloResultante: string | null;
  publicado: boolean;
  criadoEm: string;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  tamanhoBytes: number | null; // soma dos artefatos de modelo (TFLITE, JOBLIB, ADAPTER)
}

export interface TreinoModelo extends TreinoModeloResumo {
  parametros: ConfigModelo;
  log: string;
  artefatos: Artefato[];
  externoId: string | null;
}

export interface ModeloResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  tipo: TipoModelo;
  tarefa: TarefaModelo;
  tags: string[];
  dataset: { id: number; nome: string; tipo: TipoDataset } | null;
  totalTreinos: number;
  ultimoTreino: { id: number; numero: number; status: StatusJob } | null;
  publicado: { id: number; numero: number; principal: MetricaPrincipal | null } | null;
  atualizadoEm: string;
}

export interface Modelo extends Omit<ModeloResumo, 'dataset'> {
  datasetId: number | null;
  dataset: { id: number; nome: string; tipo: TipoDataset; classes: string[]; amostras: number } | null;
  config: ConfigModelo;
  criadoEm: string;
  treinos: TreinoModeloResumo[];
}

// ---------- Opções (GET /modelos/opcoes) ----------

export interface Hiperparametro {
  nome: string;
  rotulo: string;
  tipo: 'inteiro' | 'decimal' | 'texto' | 'booleano' | 'opcao';
  padrao: number | string | boolean;
  min?: number;
  max?: number;
  opcoes?: string[];
  ajuda?: string;
}

export interface OpcoesModelos {
  tinyml: { arquiteturas: { valor: ConfigModeloTinyml['arquitetura']; rotulo: string; tarefas: TarefaModelo[] }[] };
  tabular: {
    algoritmos: { valor: AlgoritmoTabular; rotulo: string; tarefas: TarefaModelo[]; exportaC: boolean; hiperparametros: Hiperparametro[] }[];
  };
  llmNuvem: { disponivel: boolean; modelosBase: string[] };
  llmLocal: { disponivel: boolean; gpu: boolean; dispositivo: string; modelosBase: ConfigModeloLlmLocal['modeloBase'][] };
}

// ---------- Datasets (amostra) ----------

export type AmostraDataset =
  | { formato: 'TABELA'; cabecalho: string[]; linhas: string[][] }
  | { formato: 'IMAGENS'; classes: { nome: string; quantidade: number; exemplos: string[] }[] }
  | { formato: 'CONVERSAS'; conversas: { messages: { role: string; content: string }[] }[] };
