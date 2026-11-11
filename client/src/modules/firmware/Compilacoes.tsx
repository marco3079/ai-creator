import { useState } from 'react';
import { Carregando, Aviso, Pagina, Selecao, Selo, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { useDados } from '../../lib/useDados';
import { PLACAS, rotuloStatus, corStatus } from '../../lib/tipos-api';
import type { BuildResumo, ProjetoResumo } from '../../lib/tipos-api';
import { DetalheBuild } from './DetalheBuild';
import './firmware.css';

function formatarTamanho(bytes: number): string {
  if (!bytes) return '—';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

export function Compilacoes() {
  const [projetoId, setProjetoId] = useState('');
  const [buildAberto, setBuildAberto] = useState<number | null>(null);
  const { dados: projetos } = useDados<ProjetoResumo[]>('/projetos');
  const { dados: builds, carregando, erro } = useDados<BuildResumo[]>(
    projetoId ? `/builds?projetoId=${projetoId}` : '/builds',
  );

  const nomeDoProjeto = (id: number | null) =>
    id === null ? '—' : (projetos?.find((p) => p.id === id)?.nome ?? `#${id}`);

  const colunas: ColunaTabela<BuildResumo>[] = [
    { titulo: 'Projeto', celula: (b) => nomeDoProjeto(b.projetoId) },
    {
      titulo: 'Placa',
      celula: (b) => PLACAS.find((p) => p.valor === b.placa)?.rotulo ?? b.placa,
    },
    {
      titulo: 'Status',
      celula: (b) => <Selo cor={corStatus(b.status)}>{rotuloStatus(b.status)}</Selo>,
    },
    { titulo: 'Tamanho', alinhar: 'direita', celula: (b) => formatarTamanho(b.tamanhoBytes ?? 0) },
    { titulo: 'Data', celula: (b) => formatarDataHora(b.criadoEm) },
  ];

  const ordenados = builds ? [...builds].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)) : [];

  return (
    <Pagina titulo="Compilações">
      <div className="firmware-filtro">
        <Selecao
          rotulo="Projeto"
          valor={projetoId}
          aoMudar={setProjetoId}
          vazio="Todos os projetos"
          opcoes={(projetos ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
        />
      </div>

      {carregando && !builds && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {builds && (
        <Tabela
          colunas={colunas}
          dados={ordenados}
          chave={(b) => b.id}
          vazio="Nenhuma compilação ainda."
          aoClicarLinha={(b) => setBuildAberto(b.id)}
        />
      )}

      <DetalheBuild
        buildId={buildAberto}
        rotuloProjeto={buildAberto !== null ? nomeDoProjeto(builds?.find((b) => b.id === buildAberto)?.projetoId ?? 0) : undefined}
        aoFechar={() => setBuildAberto(null)}
      />
    </Pagina>
  );
}
