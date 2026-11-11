import { z } from 'zod';

export const PlacaEsquema = z.enum([
  'ESP32',
  'ESP32S3',
  'ARDUINO_NANO33BLE',
  'ARDUINO_UNO',
  'STM32_NUCLEO_F401RE',
  'RP2040_PICO',
]);

export const ConfigTinymlEsquema = z.object({
  tarefa: z.literal('CLASSIFICACAO'),
  entrada: z.object({
    tipo: z.enum(['SERIE_TEMPORAL', 'AUDIO', 'TABELA']),
    canais: z.number().int().positive(),
    janela: z.number().int().positive(),
    frequenciaHz: z.number().positive(),
  }),
  classes: z.array(z.string()),
  arquitetura: z.enum(['DENSA', 'CNN1D', 'DS_CNN']),
  camadas: z.number().int().min(1).max(6),
  neuronios: z.number().int().min(4).max(256),
  epocas: z.number().int().min(1).max(500),
  taxaAprendizado: z.number().positive(),
  quantizacao: z.enum(['INT8', 'FLOAT32']),
  placaAlvo: PlacaEsquema,
  limiteRamKb: z.number().positive(),
  limiteFlashKb: z.number().positive(),
  datasetId: z.number().int().positive().nullable(),
  ultimoTreinoId: z.number().int().positive().nullable(),
});

// Entrada de criação/importação. Campos nulos significam "sem valor" (usa o padrão do tipo).
export const AgenteEntradaEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do agente'),
  descricao: z.string().optional(),
  tipo: z.enum(['LLM', 'TINYML']),
  tags: z.array(z.string()).optional(),
  projetoId: z.number().int().positive().nullable().optional(),
  provedor: z.enum(['ANTHROPIC', 'OPENAI', 'OLLAMA']).nullable().optional(),
  modelo: z.string().nullable().optional(),
  promptSistema: z.string().nullable().optional(),
  esforco: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional(),
  temperatura: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(1).max(128000).nullable().optional(),
  ferramentas: z.array(z.string()).optional(),
  configTinyml: ConfigTinymlEsquema.nullable().optional(),
});

export type AgenteEntrada = z.infer<typeof AgenteEntradaEsquema>;

// Atualização (PUT): todos os campos opcionais, mais a nota da nova versão.
export const AgenteAtualizacaoEsquema = AgenteEntradaEsquema.partial().extend({
  nota: z.string().optional(),
});

export type AgenteAtualizacao = z.infer<typeof AgenteAtualizacaoEsquema>;

export const ImportarEsquema = z.object({
  conteudo: z.string().min(1, 'Conteúdo vazio'),
  formato: z.enum(['md', 'json']),
});

export const MensagemEsquema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const MensagensEsquema = z.array(MensagemEsquema).min(1).max(200);
