import { useMemo, useState } from 'react';
import { useDados } from '../../lib/useDados';
import { Aviso, Campo, Carregando, Cartao, Pagina, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';

interface RegistroLog {
  id: number;
  acao: string;
  detalhe: string | null;
  criadoEm: string;
  usuario: { id: number; nome: string } | null;
}

// Filtro de texto feito no cliente, sobre ação, detalhe e nome do usuário.
export function Logs() {
  const { dados, carregando, erro } = useDados<RegistroLog[]>('/logs');
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo || !dados) return dados ?? [];
    return dados.filter((r) =>
      [r.acao, r.detalhe ?? '', r.usuario?.nome ?? ''].some((t) => t.toLowerCase().includes(termo)),
    );
  }, [dados, busca]);

  const colunas: ColunaTabela<RegistroLog>[] = [
    { titulo: 'Data e hora', celula: (r) => formatarDataHora(r.criadoEm) },
    { titulo: 'Usuário', celula: (r) => r.usuario?.nome ?? '—' },
    { titulo: 'Ação', celula: (r) => <code>{r.acao}</code> },
    { titulo: 'Detalhe', celula: (r) => r.detalhe ?? '—' },
  ];

  return (
    <Pagina titulo="Logs do sistema">
      <Cartao>
        <div className="grade">
          <Campo rotulo="Filtrar por ação, detalhe ou usuário" valor={busca} aoMudar={setBusca} />
        </div>
        <p className="sistema-ajuda">
          Mostrando {filtrados.length} de {dados?.length ?? 0} registros (os 200 mais recentes).
        </p>
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <Tabela<RegistroLog>
          chave={(r) => r.id}
          dados={filtrados}
          vazio="Nenhum registro encontrado para este filtro."
          colunas={colunas}
        />
      )}
    </Pagina>
  );
}
