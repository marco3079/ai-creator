import type { TreinoModeloResumo } from '../../lib/tipos-modelos';
import { corStatus, rotuloStatus } from '../../lib/tipos-api';
import { Selo, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { formatarMetrica } from './comum';

// Lista de treinos do modelo. Clicar numa linha abre o detalhe do treino (feito pelo DetalheModelo).

function formatarTamanho(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

function formatarDuracao(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return '—';
  const segundos = Math.max(0, Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 1000));
  if (Number.isNaN(segundos)) return '—';
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  if (minutos < 60) return `${minutos} min ${resto} s`;
  return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

export function AbaTreinos({
  treinos,
  aoAbrir,
}: {
  treinos: TreinoModeloResumo[];
  aoAbrir: (treinoId: number) => void;
}) {
  const colunas: ColunaTabela<TreinoModeloResumo>[] = [
    {
      titulo: 'Nº',
      celula: (t) => <strong>#{t.numero}</strong>,
    },
    {
      titulo: 'Status',
      celula: (t) => (
        <span className="det-linha">
          <Selo cor={corStatus(t.status)}>{rotuloStatus(t.status)}</Selo>
          {t.publicado && <Selo cor="verde">publicado</Selo>}
        </span>
      ),
    },
    {
      titulo: 'Métrica principal',
      celula: (t) => (t.metricas?.principal ? formatarMetrica(t.metricas.principal) : '—'),
    },
    {
      titulo: 'Tamanho',
      alinhar: 'direita',
      celula: (t) => formatarTamanho(t.tamanhoBytes),
    },
    {
      titulo: 'Duração',
      alinhar: 'direita',
      celula: (t) => formatarDuracao(t.iniciadoEm, t.finalizadoEm),
    },
    {
      titulo: 'Data',
      celula: (t) => formatarDataHora(t.criadoEm),
    },
  ];

  return (
    <Tabela
      colunas={colunas}
      dados={treinos}
      chave={(t) => t.id}
      vazio="Nenhum treino ainda. Clique em Treinar para começar."
      aoClicarLinha={(t) => aoAbrir(t.id)}
    />
  );
}
