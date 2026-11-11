import { TIPOS_MODELO } from '../../lib/tipos-modelos';
import type {
  ConfigModelo,
  MetricaPrincipal,
  TarefaModelo,
  TipoDataset,
  TipoModelo,
} from '../../lib/tipos-modelos';
import type { NomeIcone } from '../../ui/icones';

// ---------- Formatação ----------

function formatarNumeroPt(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });
}

// Métrica do treino para exibição: percentual aceita fração (0 a 1) ou porcentagem (0 a 100).
export function formatarMetrica(m: MetricaPrincipal): string {
  if (m.formato === 'percentual') {
    const pct = m.valor <= 1 ? m.valor * 100 : m.valor;
    return `${m.rotulo}: ${formatarNumeroPt(pct, 1)}%`;
  }
  return `${m.rotulo}: ${formatarNumeroPt(m.valor, 4)}`;
}

// "há 3 minutos", "há 2 dias"; a partir de 30 dias mostra a data.
export function atualizadoHa(iso: string): string {
  const tempo = new Date(iso).getTime();
  if (Number.isNaN(tempo)) return '';
  const segundos = (Date.now() - tempo) / 1000;
  if (segundos < 60) return 'atualizado agora';
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always' });
  const minutos = segundos / 60;
  const horas = minutos / 60;
  const dias = horas / 24;
  if (minutos < 60) return `atualizado ${rtf.format(-Math.round(minutos), 'minute')}`;
  if (horas < 24) return `atualizado ${rtf.format(-Math.round(horas), 'hour')}`;
  if (dias < 30) return `atualizado ${rtf.format(-Math.round(dias), 'day')}`;
  return `atualizado em ${new Date(iso).toLocaleDateString('pt-BR')}`;
}

// ---------- Tipos ----------

export function rotuloTipo(t: TipoModelo): string {
  return TIPOS_MODELO.find((x) => x.valor === t)?.rotulo ?? t;
}

export function iconeTipo(t: TipoModelo): NomeIcone {
  switch (t) {
    case 'TINYML':
      return 'cerebro';
    case 'TABULAR':
      return 'grafico';
    case 'LLM_NUVEM':
      return 'robo';
    case 'LLM_LOCAL':
      return 'chip';
  }
}

export function tarefasDoTipo(t: TipoModelo): TarefaModelo[] {
  return TIPOS_MODELO.find((x) => x.valor === t)?.tarefas ?? [];
}

export function datasetsDoTipo(t: TipoModelo) {
  return TIPOS_MODELO.find((x) => x.valor === t)?.datasets ?? [];
}

// Datasets que o tipo/tarefa aceitam (CONTRATOS-MODELOS.md §1): TinyML de imagem usa IMAGENS;
// TinyML de sinal usa CSV; LLM usa CONVERSAS.
export function datasetsAceitos(tipo: TipoModelo, tarefa: TarefaModelo | null): TipoDataset[] {
  const base = datasetsDoTipo(tipo);
  if (tipo !== 'TINYML') return base;
  return tarefa === 'IMAGEM' ? base.filter((d) => d === 'IMAGENS') : base.filter((d) => d !== 'IMAGENS');
}

// ---------- Configuração padrão no cliente ----------
// Cópia das regras do CONTRATOS-MODELOS.md §2 (server/src/modules/modelos/padroes.ts).
// Mantenha os valores iguais aos do servidor.

export function configPadraoCliente(tipo: TipoModelo, tarefa: TarefaModelo): ConfigModelo {
  switch (tipo) {
    case 'TINYML': {
      if (tarefa === 'IMAGEM') {
        return {
          entrada: {
            tipo: 'IMAGENS',
            canais: 3,
            janela: 50,
            frequenciaHz: 50,
            imagem: { largura: 96, altura: 96, cores: 1 },
          },
          arquitetura: 'CNN2D',
          camadas: 2,
          neuronios: 32,
          epocas: 40,
          taxaAprendizado: 0.003,
          tamanhoLote: 16,
          quantizacao: 'INT8',
          aumentoDados: true,
          placaAlvo: 'ESP32S3',
          limiteRamKb: 320,
          limiteFlashKb: 1024,
        };
      }
      return {
        entrada: {
          tipo: 'SERIE_TEMPORAL',
          canais: 3,
          janela: 50,
          frequenciaHz: 50,
          imagem: { largura: 96, altura: 96, cores: 1 },
        },
        arquitetura: 'DENSA',
        camadas: 2,
        neuronios: 32,
        epocas: 30,
        taxaAprendizado: 0.001,
        tamanhoLote: 32,
        quantizacao: 'INT8',
        aumentoDados: false,
        placaAlvo: 'ESP32',
        limiteRamKb: 64,
        limiteFlashKb: 256,
      };
    }
    case 'TABULAR':
      return {
        algoritmo: 'RANDOM_FOREST',
        hiperparametros: { n_estimators: 50, max_depth: 8 },
        testeFracao: 0.2,
        validacaoCruzada: 5,
        normalizar: true,
        exportarC: true,
      };
    case 'LLM_NUVEM':
      return {
        provedor: 'OPENAI',
        modeloBase: 'gpt-4.1-mini-2025-04-14',
        epocas: null,
        tamanhoLote: null,
        multiplicadorTaxa: null,
        sufixo: '',
        promptSistema: '',
      };
    case 'LLM_LOCAL':
      return {
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
  }
}
