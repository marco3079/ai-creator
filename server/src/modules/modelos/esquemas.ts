import { z } from 'zod';
import type { TipoModelo } from './padroes';

// Validação das entradas da área "Modelos" (limites conforme client/src/lib/tipos-modelos.ts).

export const PlacaModeloEsquema = z.enum([
  'ESP32',
  'ESP32S3',
  'ARDUINO_NANO33BLE',
  'ARDUINO_UNO',
  'STM32_NUCLEO_F401RE',
  'RP2040_PICO',
]);

const regexSufixo = /^[a-z0-9-]{0,18}$/;
const regexNomeOllama = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export const ConfigTinymlEsquema = z.object({
  entrada: z.object({
    tipo: z.enum(['SERIE_TEMPORAL', 'AUDIO', 'TABELA', 'IMAGENS']),
    canais: z.number().int().min(1).max(32),
    janela: z.number().int().min(1).max(10000),
    frequenciaHz: z.number().positive().max(100000),
    imagem: z.object({
      largura: z.number().int().min(16).max(320),
      altura: z.number().int().min(16).max(320),
      cores: z.union([z.literal(1), z.literal(3)]),
    }),
  }),
  arquitetura: z.enum(['DENSA', 'CNN1D', 'DS_CNN', 'CNN2D']),
  camadas: z.number().int().min(1).max(6),
  neuronios: z.number().int().min(4).max(256),
  epocas: z.number().int().min(1).max(500),
  taxaAprendizado: z.number().positive().max(1),
  tamanhoLote: z.number().int().min(8).max(256),
  quantizacao: z.enum(['INT8', 'FLOAT32']),
  aumentoDados: z.boolean(),
  placaAlvo: PlacaModeloEsquema,
  limiteRamKb: z.number().positive(),
  limiteFlashKb: z.number().positive(),
});

export const ConfigTabularEsquema = z.object({
  algoritmo: z.enum(['ARVORE', 'RANDOM_FOREST', 'GRADIENT_BOOSTING', 'LOGISTICA', 'LINEAR', 'KNN', 'SVM']),
  hiperparametros: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  testeFracao: z.number().min(0.1).max(0.5),
  validacaoCruzada: z
    .number()
    .int()
    .min(0)
    .max(10)
    .refine((v) => v === 0 || v >= 2, 'Validação cruzada: use 0 (desligada) ou de 2 a 10 dobras'),
  normalizar: z.boolean(),
  exportarC: z.boolean(),
});

export const ConfigLlmNuvemEsquema = z.object({
  provedor: z.literal('OPENAI'),
  modeloBase: z.string().trim().min(1, 'Informe o modelo base').max(100),
  epocas: z.number().int().min(1).max(50).nullable(),
  tamanhoLote: z.number().int().min(1).max(256).nullable(),
  multiplicadorTaxa: z.number().positive().max(10).nullable(),
  sufixo: z.string().regex(regexSufixo, 'Sufixo: até 18 caracteres, use a-z, 0-9 e hífen'),
  promptSistema: z.string().max(20000),
});

export const ConfigLlmLocalEsquema = z.object({
  modeloBase: z.enum(['llama3.2:1b', 'llama3.2:3b']),
  loraRank: z.number().int().min(4).max(64),
  loraAlpha: z.number().int().min(8).max(128),
  epocas: z.number().int().min(1).max(10),
  taxaAprendizado: z.number().positive().max(1),
  tamanhoLote: z.number().int().min(1).max(16),
  comprimentoMax: z.number().int().min(256).max(4096),
  nomeOllama: z
    .string()
    .refine((v) => v === '' || regexNomeOllama.test(v), 'Nome no Ollama: use a-z, 0-9, ponto, hífen, dois-pontos (até 64)'),
  promptSistema: z.string().max(20000),
});

// Esquema de config conforme o tipo do modelo.
export function esquemaConfig(tipo: TipoModelo) {
  switch (tipo) {
    case 'TINYML':
      return ConfigTinymlEsquema;
    case 'TABULAR':
      return ConfigTabularEsquema;
    case 'LLM_NUVEM':
      return ConfigLlmNuvemEsquema;
    case 'LLM_LOCAL':
      return ConfigLlmLocalEsquema;
  }
}

const TipoModeloEsquema = z.enum(['TINYML', 'TABULAR', 'LLM_NUVEM', 'LLM_LOCAL']);
const TarefaModeloEsquema = z.enum(['CLASSIFICACAO', 'REGRESSAO', 'IMAGEM', 'CHAT']);
const TagsEsquema = z.array(z.string().trim().min(1).max(40)).max(20);

// POST /modelos — config é parcial e é mesclada sobre configPadrao.
export const NovoModeloEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do modelo').max(120),
  descricao: z.string().max(2000).optional(),
  tipo: TipoModeloEsquema,
  tarefa: TarefaModeloEsquema,
  datasetId: z.number().int().positive().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: TagsEsquema.optional(),
});

// PUT /modelos/:id — tipo e tarefa não mudam.
export const AtualizarModeloEsquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do modelo').max(120).optional(),
  descricao: z.string().max(2000).optional(),
  datasetId: z.number().int().positive().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: TagsEsquema.optional(),
});
