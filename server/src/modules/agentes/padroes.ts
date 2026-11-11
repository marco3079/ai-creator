// Tipos e valores padrão dos agentes (contratos §2 e §3).

export type PlacaTipo =
  | 'ESP32'
  | 'ESP32S3'
  | 'ARDUINO_NANO33BLE'
  | 'ARDUINO_UNO'
  | 'STM32_NUCLEO_F401RE'
  | 'RP2040_PICO';

export type ProvedorTipo = 'ANTHROPIC' | 'OPENAI' | 'OLLAMA';

export interface ConfigTinyml {
  tarefa: 'CLASSIFICACAO';
  entrada: { tipo: 'SERIE_TEMPORAL' | 'AUDIO' | 'TABELA'; canais: number; janela: number; frequenciaHz: number };
  classes: string[];
  arquitetura: 'DENSA' | 'CNN1D' | 'DS_CNN';
  camadas: number; // 1..6
  neuronios: number; // 4..256
  epocas: number; // 1..500
  taxaAprendizado: number; // ex.: 0.001
  quantizacao: 'INT8' | 'FLOAT32';
  placaAlvo: PlacaTipo;
  limiteRamKb: number;
  limiteFlashKb: number;
  datasetId: number | null;
  ultimoTreinoId: number | null;
}

export const CONFIG_TINYML_PADRAO: ConfigTinyml = {
  tarefa: 'CLASSIFICACAO',
  entrada: { tipo: 'SERIE_TEMPORAL', canais: 3, janela: 50, frequenciaHz: 50 },
  classes: [],
  arquitetura: 'DENSA',
  camadas: 2,
  neuronios: 32,
  epocas: 30,
  taxaAprendizado: 0.001,
  quantizacao: 'INT8',
  placaAlvo: 'ESP32',
  limiteRamKb: 64,
  limiteFlashKb: 256,
  datasetId: null,
  ultimoTreinoId: null,
};

// Padrões aplicados a um agente LLM novo (ou sem provedor/modelo gravados).
// Os valores seguem os padrões já usados em provedores/anthropic.ts.
export const AGENTE_LLM_PADRAO = {
  provedor: 'ANTHROPIC' as ProvedorTipo,
  esforco: 'high',
  temperatura: 1,
  maxTokens: 64000,
};

// Modelo padrão por provedor, usado quando o agente LLM não define modelo.
export const MODELO_PADRAO_POR_PROVEDOR: Record<ProvedorTipo, string> = {
  ANTHROPIC: 'claude-opus-5-5',
  OPENAI: 'gpt-5',
  OLLAMA: 'llama3.2',
};

export interface AgenteResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  tipo: 'LLM' | 'TINYML';
  tags: string[];
  provedor: ProvedorTipo | null;
  modelo: string | null;
  versao: number;
  atualizadoEm: Date;
  projeto: { id: number; nome: string } | null;
}

export interface Agente extends AgenteResumo {
  promptSistema: string | null;
  esforco: string | null;
  temperatura: number | null;
  maxTokens: number | null;
  ferramentas: string[];
  configTinyml: ConfigTinyml | null;
  projetoId: number | null;
  criadoEm: Date;
}
