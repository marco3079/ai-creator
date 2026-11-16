import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ResumoAtualizacao } from '../lib/tipos-atualizacao';
import { Icone } from '../ui/icones';
import '../modules/sistema/atualizacao.css';

// Consulta do resumo a cada 30 min, só com a aba visível.
const INTERVALO_MS = 30 * 60 * 1000;
const CHAVE_DISPENSADA = 'aicreator.atualizacao.dispensada';

function lerDispensada(): string | null {
  try {
    return localStorage.getItem(CHAVE_DISPENSADA);
  } catch {
    return null;
  }
}

function guardarDispensada(remoto: string): void {
  try {
    localStorage.setItem(CHAVE_DISPENSADA, remoto);
  } catch {
    // Sem armazenamento: o aviso só fica escondido nesta sessão (estado da tela).
  }
}

// Faixa discreta no topo do conteúdo, só para ADMIN, quando há versão nova no GitHub.
export function AvisoAtualizacao() {
  const { usuario } = useAuth();
  const admin = usuario?.perfil === 'ADMIN';
  const [resumo, setResumo] = useState<ResumoAtualizacao | null>(null);
  const [dispensada, setDispensada] = useState<string | null>(lerDispensada);

  useEffect(() => {
    if (!admin) return;
    let ativo = true;
    let timer: number | undefined;

    async function consultar() {
      try {
        const r = await api.get<ResumoAtualizacao>('/atualizacao/resumo');
        if (ativo) setResumo(r);
      } catch {
        // Erros silenciosos: o aviso é só informativo.
      }
    }

    function iniciarTemporizador() {
      window.clearInterval(timer);
      timer = window.setInterval(consultar, INTERVALO_MS);
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === 'hidden') {
        window.clearInterval(timer);
        timer = undefined;
      } else {
        void consultar();
        iniciarTemporizador();
      }
    }

    if (document.visibilityState !== 'hidden') {
      void consultar();
      iniciarTemporizador();
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    return () => {
      ativo = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [admin]);

  if (!admin || resumo === null || !resumo.disponivel || resumo.atras <= 0) return null;

  const chave = resumo.remoto ?? '';
  if (dispensada === chave) return null;

  const alteracoes = resumo.atras === 1 ? '1 alteração' : `${resumo.atras} alterações`;

  function dispensar() {
    setDispensada(chave);
    guardarDispensada(chave);
  }

  return (
    <div className="aviso-atualizacao" role="status">
      <Icone nome="download" tamanho={18} className="aviso-atualizacao-icone" />
      <span className="aviso-atualizacao-texto">{`Há uma versão nova do AI Creator (${alteracoes}).`}</span>
      <Link to="/app/atualizacao" className="aviso-atualizacao-link">
        Ver atualização
      </Link>
      <button
        type="button"
        className="aviso-atualizacao-fechar"
        aria-label="Dispensar aviso de atualização"
        title="Dispensar"
        onClick={dispensar}
      >
        <Icone nome="fechar" tamanho={16} />
      </button>
    </div>
  );
}
