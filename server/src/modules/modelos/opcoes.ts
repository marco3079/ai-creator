// GET /modelos/opcoes (CONTRATOS-MODELOS §3): arquiteturas, algoritmos e disponibilidade dos provedores.
import { config } from '../../lib/config';
import type { AlgoritmoTabular, ConfigModeloLlmLocal, ConfigModeloTinyml, TarefaModelo } from './padroes';

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
    algoritmos: {
      valor: AlgoritmoTabular;
      rotulo: string;
      tarefas: TarefaModelo[];
      exportaC: boolean;
      hiperparametros: Hiperparametro[];
    }[];
  };
  llmNuvem: { disponivel: boolean; modelosBase: string[] };
  llmLocal: { disponivel: boolean; gpu: boolean; dispositivo: string; modelosBase: ConfigModeloLlmLocal['modeloBase'][] };
}

const ARQUITETURAS: OpcoesModelos['tinyml']['arquiteturas'] = [
  { valor: 'DENSA', rotulo: 'Densa (camadas totalmente conectadas)', tarefas: ['CLASSIFICACAO', 'REGRESSAO'] },
  { valor: 'CNN1D', rotulo: 'CNN 1D (sinais)', tarefas: ['CLASSIFICACAO', 'REGRESSAO'] },
  { valor: 'DS_CNN', rotulo: 'DS-CNN (leve, para microcontroladores)', tarefas: ['CLASSIFICACAO'] },
  { valor: 'CNN2D', rotulo: 'CNN 2D (imagens)', tarefas: ['IMAGEM'] },
];

const ALGORITMOS: OpcoesModelos['tabular']['algoritmos'] = [
  {
    valor: 'ARVORE',
    rotulo: 'Árvore de decisão',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    exportaC: true,
    hiperparametros: [
      { nome: 'max_depth', rotulo: 'Profundidade máxima', tipo: 'inteiro', padrao: 8, min: 1, max: 50 },
      { nome: 'min_samples_leaf', rotulo: 'Amostras mínimas por folha', tipo: 'inteiro', padrao: 1, min: 1, max: 50 },
    ],
  },
  {
    valor: 'RANDOM_FOREST',
    rotulo: 'Random Forest',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    exportaC: true,
    hiperparametros: [
      { nome: 'n_estimators', rotulo: 'Número de árvores', tipo: 'inteiro', padrao: 50, min: 5, max: 500 },
      { nome: 'max_depth', rotulo: 'Profundidade máxima', tipo: 'inteiro', padrao: 8, min: 1, max: 50 },
    ],
  },
  {
    valor: 'GRADIENT_BOOSTING',
    rotulo: 'Gradient Boosting',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    // O m2cgen 0.10 não exporta GradientBoosting do scikit-learn (nem classificação nem regressão).
    exportaC: false,
    hiperparametros: [
      { nome: 'n_estimators', rotulo: 'Número de estágios', tipo: 'inteiro', padrao: 100, min: 10, max: 500 },
      { nome: 'learning_rate', rotulo: 'Taxa de aprendizado', tipo: 'decimal', padrao: 0.1, min: 0.001, max: 1 },
      { nome: 'max_depth', rotulo: 'Profundidade máxima', tipo: 'inteiro', padrao: 3, min: 1, max: 10 },
    ],
  },
  {
    valor: 'LOGISTICA',
    rotulo: 'Regressão logística',
    tarefas: ['CLASSIFICACAO'],
    exportaC: true,
    hiperparametros: [
      { nome: 'C', rotulo: 'Regularização (C)', tipo: 'decimal', padrao: 1, min: 0.001, max: 100 },
      { nome: 'max_iter', rotulo: 'Iterações máximas', tipo: 'inteiro', padrao: 1000, min: 100, max: 5000 },
    ],
  },
  {
    valor: 'LINEAR',
    rotulo: 'Regressão linear (Ridge)',
    tarefas: ['REGRESSAO'],
    exportaC: true,
    hiperparametros: [{ nome: 'alpha', rotulo: 'Regularização (alpha)', tipo: 'decimal', padrao: 1, min: 0, max: 100 }],
  },
  {
    valor: 'KNN',
    rotulo: 'k vizinhos (KNN)',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    exportaC: false,
    hiperparametros: [{ nome: 'n_neighbors', rotulo: 'Número de vizinhos (k)', tipo: 'inteiro', padrao: 5, min: 1, max: 50 }],
  },
  {
    valor: 'SVM',
    rotulo: 'SVM',
    tarefas: ['CLASSIFICACAO', 'REGRESSAO'],
    exportaC: true,
    hiperparametros: [
      { nome: 'C', rotulo: 'Regularização (C)', tipo: 'decimal', padrao: 1, min: 0.001, max: 100 },
      {
        nome: 'kernel',
        rotulo: 'Kernel',
        tipo: 'opcao',
        padrao: 'rbf',
        opcoes: ['linear', 'rbf'],
        ajuda: 'Só o kernel linear exporta código C para a placa.',
      },
    ],
  },
];

const MODELOS_BASE_NUVEM = ['gpt-4.1-mini-2025-04-14', 'gpt-4.1-nano-2025-04-14', 'gpt-4o-mini-2024-07-18'];
const MODELOS_BASE_LOCAL: ConfigModeloLlmLocal['modeloBase'][] = ['llama3.2:1b', 'llama3.2:3b'];

// Consulta o finetuner (timeout 2 s). Qualquer falha vira "indisponível".
async function consultarFinetuner(): Promise<{ disponivel: boolean; gpu: boolean; dispositivo: string }> {
  const indisponivel = { disponivel: false, gpu: false, dispositivo: '' };
  try {
    const resposta = await fetch(`${config.finetunerUrl}/saude`, { signal: AbortSignal.timeout(2000) });
    if (!resposta.ok) return indisponivel;
    const corpo = (await resposta.json()) as { ok?: boolean; gpu?: boolean; dispositivo?: string };
    return { disponivel: corpo.ok !== false, gpu: !!corpo.gpu, dispositivo: String(corpo.dispositivo ?? '') };
  } catch {
    return indisponivel;
  }
}

export async function obterOpcoes(): Promise<OpcoesModelos> {
  const finetuner = await consultarFinetuner();
  return {
    tinyml: { arquiteturas: ARQUITETURAS },
    tabular: { algoritmos: ALGORITMOS },
    llmNuvem: { disponivel: !!config.openaiChave, modelosBase: MODELOS_BASE_NUVEM },
    llmLocal: { ...finetuner, modelosBase: MODELOS_BASE_LOCAL },
  };
}
