import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDados } from '../lib/useDados';
import { corStatus, rotuloStatus } from '../lib/tipos-api';
import type { PainelRecente, PainelResposta } from '../lib/tipos-api';
import { formatarDataHora } from '../ui';
import { Icone } from '../ui/icones';

// Intervalo de atualização do sino (a lista vem de GET /painel).
const INTERVALO_MS = 60000;

// Sino do topo: contador de atividades em execução ou com falha e painel com as 6 mais recentes.
export function Notificacoes() {
  const navigate = useNavigate();
  const { dados, erro, recarregar } = useDados<PainelResposta>('/painel');
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  // Atualiza a cada 60 s e quando a janela volta a ter foco. recarregar é estável.
  useEffect(() => {
    const intervalo = window.setInterval(() => recarregar(), INTERVALO_MS);
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
    };
  }, [recarregar]);

  const recentes: PainelRecente[] = dados?.recentes ?? [];
  const emAndamento = recentes.filter((r) => r.status === 'EXECUTANDO' || r.status === 'FALHA').length;

  function abrirAtividade(r: PainelRecente) {
    setAberto(false);
    navigate(r.tipo === 'BUILD' ? '/app/builds' : '/app/tinyml');
  }

  return (
    <div className="casca-sino-area" ref={area}>
      <button
        type="button"
        className="casca-botao-redondo"
        aria-label="Atividades"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="sino" tamanho={22} />
        {emAndamento > 0 && (
          <span className="casca-contador" aria-hidden="true">
            {emAndamento > 9 ? '9+' : emAndamento}
          </span>
        )}
      </button>

      {aberto && (
        <div className="casca-painel-avisos" role="dialog" aria-label="Atividade recente">
          <div className="casca-painel-cabecalho">
            <strong>Atividade recente</strong>
          </div>

          {erro && <p className="casca-painel-vazio">Não foi possível carregar as atividades.</p>}
          {!erro && recentes.length === 0 && <p className="casca-painel-vazio">Nenhuma atividade.</p>}

          <ul className="casca-avisos-lista">
            {recentes.map((r) => (
              <li key={`${r.tipo}-${r.id}`}>
                <button type="button" className="casca-aviso" onClick={() => abrirAtividade(r)}>
                  <span className="casca-aviso-texto">
                    <span className="casca-aviso-titulo">{r.titulo}</span>
                    <span className="casca-aviso-meta">
                      {r.tipo === 'BUILD' ? 'Compilação' : 'Treino'} · {formatarDataHora(r.criadoEm)}
                    </span>
                  </span>
                  <span className={`selo selo-${corStatus(r.status)}`}>{rotuloStatus(r.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
