// Tipos da API HTTP do server (CONTRATOS.md §2 e §3). Mantenha fiel ao contrato.

// ---------- Placas e jobs ----------

export type Placa =
  | 'ESP32'
  | 'ESP32S3'
  | 'ARDUINO_NANO33BLE'
  | 'ARDUINO_UNO'
  | 'STM32_NUCLEO_F401RE'
  | 'RP2040_PICO';

export const PLACAS: { valor: Placa; rotulo: string }[] = [
  { valor: 'ESP32', rotulo: 'ESP32' },
  { valor: 'ESP32S3', rotulo: 'ESP32-S3' },
  { valor: 'ARDUINO_NANO33BLE', rotulo: 'Arduino Nano 33 BLE' },
  { valor: 'ARDUINO_UNO', rotulo: 'Arduino Uno' },
  { valor: 'STM32_NUCLEO_F401RE', rotulo: 'STM32 Nucleo F401RE' },
  { valor: 'RP2040_PICO', rotulo: 'Raspberry Pi Pico (RP2040)' },
];

export type StatusJob = 'FILA' | 'EXECUTANDO' | 'SUCESSO' | 'FALHA' | 'CANCELADO';

const ROTULOS_STATUS: Record<StatusJob, string> = {
  FILA: 'Na fila',
  EXECUTANDO: 'Executando',
  SUCESSO: 'Concluído',
  FALHA: 'Falhou',
  CANCELADO: 'Cancelado',
};

const CORES_STATUS: Record<StatusJob, 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza'> = {
  FILA: 'cinza',
  EXECUTANDO: 'azul',
  SUCESSO: 'verde',
  FALHA: 'vermelho',
  CANCELADO: 'amarelo',
};

export function rotuloStatus(s: StatusJob): string {
  return ROTULOS_STATUS[s] ?? s;
}

export function corStatus(s: StatusJob): 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza' {
  return CORES_STATUS[s] ?? 'cinza';
}

// ---------- Agentes ----------

export type TipoAgente = 'LLM' | 'TINYML';
export type Provedor = 'ANTHROPIC' | 'OPENAI' | 'OLLAMA';

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
  placaAlvo: Placa;
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

export interface AgenteResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  tipo: TipoAgente;
  tags: string[];
  provedor: Provedor | null;
  modelo: string | null;
  versao: number;
  atualizadoEm: string;
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
  criadoEm: string;
}

// Mensagem de conversa, no formato dos provedores de LLM do server.
export interface MensagemChat {
  role: 'user' | 'assistant';
  content: string;
}

// ---------- Datasets e treinos ----------

export interface Dataset {
  id: number;
  nome: string;
  descricao: string;
  tipo: string; // SERIE_TEMPORAL | AUDIO | TABELA
  classes: string[];
  janela: number;
  amostras: number;
  colunas: number;
  criadoEm: string;
}

export interface MetricasTreino {
  acuracia?: number;
  perda?: number;
  acuraciaValidacao?: number;
  matrizConfusao?: number[][];
  classes?: string[];
}

export interface TreinoResumo {
  id: number;
  agenteId: number;
  datasetId: number;
  status: StatusJob;
  metricas: MetricasTreino | null;
  tamanhoBytes: number | null;
  criadoEm: string;
  finalizadoEm: string | null;
}

export interface Treino extends TreinoResumo {
  log: string;
}

// ---------- Projetos e builds ----------

export interface ArquivoInfo {
  caminho: string;
  atualizadoEm: string;
  conteudo?: string;
}

export interface ProjetoResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  placa: Placa;
  framework: string;
  atualizadoEm: string;
  totalArquivos: number;
  ultimoBuild: { id: number; status: StatusJob; criadoEm: string } | null;
}

export interface Projeto extends ProjetoResumo {
  arquivos: ArquivoInfo[];
}

export interface BuildResumo {
  id: number;
  projetoId: number;
  placa: Placa;
  status: StatusJob;
  tamanhoBytes: number | null;
  offset: string | null;
  criadoEm: string;
  finalizadoEm: string | null;
}

export interface Build extends BuildResumo {
  log: string;
}

export interface Dispositivo {
  id: number;
  nome: string;
  placa: Placa;
  porta: string;
  notas: string;
  ultimoBuildId: number | null;
  ultimaGravacao: string | null;
}

// ---------- Tokens de API ----------

export interface TokenApiInfo {
  id: number;
  nome: string;
  prefixo: string;
  criadoEm: string;
  ultimoUso: string | null;
  revogado: boolean;
}

// ---------- Painel (GET /painel) ----------

export interface PainelRecente {
  tipo: 'BUILD' | 'TREINO';
  id: number;
  titulo: string;
  status: StatusJob;
  criadoEm: string;
}

export interface PainelResposta {
  contagens: {
    agentesLlm: number;
    agentesTinyml: number;
    projetos: number;
    dispositivos: number;
    treinosSucesso: number;
    buildsSucesso: number;
  };
  buildsPorDia: { dia: string; sucesso: number; falha: number }[]; // 14 dias, inclui dias zerados
  recentes: PainelRecente[]; // 6 atividades
  destaque: AgenteResumo | null; // agente atualizado por último
}
