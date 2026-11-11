import { useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Modal, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';

interface VersaoResumo {
  versao: number;
  nota: string;
  criadoEm: string;
}

interface VersaoCompleta extends VersaoResumo {
  snapshot: unknown;
}

export function Versoes({
  agenteId,
  podeEscrever,
  aoRestaurar,
}: {
  agenteId: number;
  podeEscrever: boolean;
  aoRestaurar: (versao: number) => void;
}) {
  const lista = useDados<VersaoResumo[]>(`/agentes/${agenteId}/versoes`);
  const [verNumero, setVerNumero] = useState<number | null>(null);
  const detalhe = useDados<VersaoCompleta>(
    verNumero !== null ? `/agentes/${agenteId}/versoes/${verNumero}` : null,
  );
  const [restaurarNumero, setRestaurarNumero] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function restaurar() {
    if (restaurarNumero === null) return;
    setErroAcao(null);
    setOcupado(true);
    try {
      await api.post(`/agentes/${agenteId}/versoes/${restaurarNumero}/restaurar`);
      const numero = restaurarNumero;
      setRestaurarNumero(null);
      aoRestaurar(numero);
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setOcupado(false);
    }
  }

  const colunas: ColunaTabela<VersaoResumo>[] = [
    { titulo: 'Versão', celula: (v) => `v${v.versao}` },
    { titulo: 'Nota', celula: (v) => v.nota || '—' },
    { titulo: 'Data', celula: (v) => formatarDataHora(v.criadoEm) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (v) => (
        <div className="agentes-acoes-versao">
          <Botao variante="texto" aoClicar={() => setVerNumero(v.versao)}>
            Ver
          </Botao>
          {podeEscrever && (
            <Botao variante="texto" aoClicar={() => setRestaurarNumero(v.versao)}>
              Restaurar
            </Botao>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="agentes-versoes">
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && <Carregando />}
      {lista.dados && (
        <Tabela<VersaoResumo>
          chave={(v) => v.versao}
          dados={lista.dados}
          vazio="Nenhuma versão encontrada."
          colunas={colunas}
        />
      )}

      <Modal
        aberto={verNumero !== null}
        titulo={verNumero !== null ? `Versão ${verNumero}` : 'Versão'}
        aoFechar={() => setVerNumero(null)}
      >
        {detalhe.carregando && <Carregando />}
        {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
        {detalhe.dados && (
          <>
            <p className="agentes-ajuda">
              {detalhe.dados.nota || 'Sem nota'} · {formatarDataHora(detalhe.dados.criadoEm)}
            </p>
            <pre className="agentes-pre">{JSON.stringify(detalhe.dados.snapshot, null, 2)}</pre>
          </>
        )}
      </Modal>

      <Modal
        aberto={restaurarNumero !== null}
        titulo="Restaurar versão"
        aoFechar={() => setRestaurarNumero(null)}
      >
        <p>
          Restaurar a versão <strong>{restaurarNumero}</strong>? O conteúdo atual do agente será
          substituído e isso vira uma nova versão, então nada se perde.
        </p>
        <div className="pagina-acoes">
          <Botao desabilitado={ocupado} aoClicar={restaurar}>
            Restaurar
          </Botao>
          <Botao variante="secundario" aoClicar={() => setRestaurarNumero(null)}>
            Cancelar
          </Botao>
        </div>
      </Modal>
    </div>
  );
}
