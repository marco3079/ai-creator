import { useEffect, useState } from 'react';
import { Aviso, Carregando, Modal, Selo, formatarDataHora } from '../../ui';
import { api } from '../../lib/api';
import { rotuloStatus, corStatus, PLACAS } from '../../lib/tipos-api';
import type { Build } from '../../lib/tipos-api';
import { Gravador } from './Gravador';

// Detalhe de um build: log completo, download e gravação. Abre dentro de um Modal.
export function DetalheBuild({
  buildId,
  rotuloProjeto,
  aoFechar,
}: {
  buildId: number | null;
  rotuloProjeto?: string;
  aoFechar: () => void;
}) {
  const [build, setBuild] = useState<Build | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (buildId === null) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setBuild(null);
    api
      .get<Build>(`/builds/${buildId}`)
      .then((b) => {
        if (!cancelado) setBuild(b);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Erro ao carregar o build');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [buildId]);

  const rotuloPlaca = build ? PLACAS.find((p) => p.valor === build.placa)?.rotulo ?? build.placa : '';

  return (
    <Modal
      aberto={buildId !== null}
      titulo={`Build #${buildId ?? ''}`}
      aoFechar={aoFechar}
    >
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {build && (
        <div className="firmware-detalhe-build">
          <dl className="firmware-dl">
            {rotuloProjeto && (
              <>
                <dt>Projeto</dt>
                <dd>{rotuloProjeto}</dd>
              </>
            )}
            <dt>Placa</dt>
            <dd>{rotuloPlaca}</dd>
            <dt>Status</dt>
            <dd>
              <Selo cor={corStatus(build.status)}>{rotuloStatus(build.status)}</Selo>
            </dd>
            <dt>Tamanho</dt>
            <dd>{build.tamanhoBytes ? `${(build.tamanhoBytes / 1024).toFixed(1)} KB` : '—'}</dd>
            <dt>Criado em</dt>
            <dd>{formatarDataHora(build.criadoEm)}</dd>
          </dl>

          {build.log && <pre className="firmware-log">{build.log}</pre>}

          {build.status === 'SUCESSO' && <Gravador build={build} />}
        </div>
      )}
    </Modal>
  );
}
