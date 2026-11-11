// Tipos e valores padrão da área "Modelos" (fonte: docs/plano/CONTRATOS-MODELOS.md §1 e §2).
// Espelham client/src/lib/tipos-modelos.ts.

export type TipoModelo = 'TINYML' | 'TABULAR' | 'LLM_NUVEM' | 'LLM_LOCAL';
export type TarefaModelo = 'CLASSIFICACAO' | 'REGRESSAO' | 'IMAGEM' | 'CHAT';
export type TipoDataset = 'SERIE_TEMPORAL' | 'AUDIO' | 'TABELA' | 'IMAGENS' | 'CONVERSAS';

// Tabela §1: tarefas aceitas por tipo de modelo.
export const TAREFAS_POR_TIPO: Record<TipoModelo, TarefaModelo[]> = {
  TINYML: ['CLASSIFICACAO', 'REGRESSAO', 'IMAGEM'],
  TABULAR: ['CLASSIFICACAO', 'REGRESSAO'],
  LLM_NUVEM: ['CHAT'],
  LLM_LOCAL: ['CHAT'],
};

// Tabela §1: datasets aceitos por tipo de modelo.
export const DATASETS_POR_TIPO: Record<TipoModelo, TipoDataset[]> = {
  TINYML: ['SERIE_TEMPORAL', 'TABELA', 'AUDIO', 'IMAGENS'],
  TABULAR: ['SERIE_TEMPORAL', 'TABELA', 'AUDIO'],
  LLM_NUVEM: ['CONVERSAS'],
  LLM_LOCAL: ['CONVERSAS'],
};

export type PlacaModelo =
  | 'ESP32'
  | 'ESP32S3'
  | 'ARDUINO_NANO33BLE'
  | 'ARDUINO_UNO'
  | 'STM32_NUCLEO_F401RE'
  | 'RP2040_PICO';

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
  placaAlvo: PlacaModelo;
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
  epocas: number | null;
  tamanhoLote: number | null;
  multiplicadorTaxa: number | null;
  sufixo: string; // até 18 caracteres [a-z0-9-]
  promptSistema: string;
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

// Configuração padrão por tipo/tarefa (CONTRATOS-MODELOS.md §2).
export function configPadrao(tipo: TipoModelo, tarefa: TarefaModelo): ConfigModelo {
  if (tipo === 'TINYML') {
    const imagens = tarefa === 'IMAGEM';
    const cfg: ConfigModeloTinyml = {
      entrada: {
        tipo: imagens ? 'IMAGENS' : 'SERIE_TEMPORAL',
        canais: 3,
        janela: 50,
        frequenciaHz: 50,
        imagem: { largura: 96, altura: 96, cores: 1 },
      },
      arquitetura: imagens ? 'CNN2D' : 'DENSA',
      camadas: 2,
      neuronios: 32,
      epocas: imagens ? 40 : 30,
      taxaAprendizado: imagens ? 0.003 : 0.001,
      tamanhoLote: imagens ? 16 : 32,
      quantizacao: 'INT8',
      aumentoDados: imagens,
      placaAlvo: imagens ? 'ESP32S3' : 'ESP32',
      limiteRamKb: imagens ? 320 : 64,
      limiteFlashKb: imagens ? 1024 : 256,
    };
    return cfg;
  }
  if (tipo === 'TABULAR') {
    const cfg: ConfigModeloTabular = {
      algoritmo: 'RANDOM_FOREST',
      hiperparametros: { n_estimators: 50, max_depth: 8 },
      testeFracao: 0.2,
      validacaoCruzada: 5,
      normalizar: true,
      exportarC: true,
    };
    return cfg;
  }
  if (tipo === 'LLM_NUVEM') {
    const cfg: ConfigModeloLlmNuvem = {
      provedor: 'OPENAI',
      modeloBase: 'gpt-4.1-mini-2025-04-14',
      epocas: null,
      tamanhoLote: null,
      multiplicadorTaxa: null,
      sufixo: '',
      promptSistema: '',
    };
    return cfg;
  }
  const cfg: ConfigModeloLlmLocal = {
    modeloBase: 'llama3.2:1b',
    loraRank: 16,
    loraAlpha: 32,
    epocas: 3,
    taxaAprendizado: 0.0002,
    tamanhoLote: 2,
    comprimentoMax: 1024,
    nomeOllama: '',
    promptSistema: '',
  };
  return cfg;
}

// ---------- Tipos de saída (espelham client/src/lib/tipos-modelos.ts) ----------

export type TipoArtefato = 'TFLITE' | 'HEADER_C' | 'JOBLIB' | 'ADAPTER' | 'METRICAS' | 'OUTRO';

export interface Artefato {
  nome: string;
  tipo: TipoArtefato;
  caminho: string; // relativo a /data
  tamanhoBytes: number;
}

export interface MetricaPrincipal {
  nome: string;
  rotulo: string;
  valor: number;
  formato: 'percentual' | 'numero';
}

export interface MetricasModelo {
  principal?: MetricaPrincipal;
  [chave: string]: unknown;
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
  ultimoTreino: { id: number; numero: number; status: string } | null;
  publicado: { id: number; numero: number; principal: MetricaPrincipal | null } | null;
  atualizadoEm: string;
}

// Tipos de modelo aceitos (validação de filtros e entradas).
export const TIPOS_MODELO_VALIDOS: TipoModelo[] = ['TINYML', 'TABULAR', 'LLM_NUVEM', 'LLM_LOCAL'];
