import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

// Identidade da plataforma (nome, slogan e cor primária), vinda de GET /plataforma.
// Guardada em localStorage para a primeira pintura já sair com a identidade certa.

export interface Plataforma {
  nome: string;
  slogan: string;
  corPrimaria: string;
}

export const PLATAFORMA_PADRAO: Plataforma = {
  nome: 'AI Creator',
  slogan: 'Agentes de IA, TinyML e firmware',
  corPrimaria: '#2563eb',
};

const CHAVE_ARMAZENAMENTO = 'aicreator.plataforma';
const REGEX_COR = /^#[0-9a-fA-F]{6}$/;
const LOGO_SRC = '/logo.svg';

const VARIAVEIS_COR = [
  '--cor-primaria',
  '--cor-primaria-escura',
  '--cor-primaria-suave',
  '--cor-azul-suave',
  '--gradiente-primario',
  '--sombra-primaria',
];

function normalizar(dados: Partial<Plataforma>): Plataforma {
  return {
    nome: typeof dados.nome === 'string' && dados.nome ? dados.nome : PLATAFORMA_PADRAO.nome,
    slogan: typeof dados.slogan === 'string' ? dados.slogan : PLATAFORMA_PADRAO.slogan,
    corPrimaria:
      typeof dados.corPrimaria === 'string' && REGEX_COR.test(dados.corPrimaria)
        ? dados.corPrimaria.toLowerCase()
        : PLATAFORMA_PADRAO.corPrimaria,
  };
}

function lerGuardada(): Plataforma | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (!bruto) return null;
    return normalizar(JSON.parse(bruto) as Partial<Plataforma>);
  } catch {
    return null;
  }
}

function gravarNoNavegador(plataforma: Plataforma): void {
  try {
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(plataforma));
  } catch {
    // Sem armazenamento a identidade só vale até recarregar a página.
  }
}

// Aplica a cor primária nas variáveis CSS. Com a cor padrão, remove as variáveis (valem as do tema).
function aplicarCor(plataforma: Plataforma): void {
  const estilo = document.documentElement.style;
  const primaria = plataforma.corPrimaria;

  if (primaria === PLATAFORMA_PADRAO.corPrimaria) {
    VARIAVEIS_COR.forEach((variavel) => estilo.removeProperty(variavel));
    return;
  }

  estilo.setProperty('--cor-primaria', primaria);
  estilo.setProperty('--cor-primaria-escura', `color-mix(in srgb, ${primaria} 82%, black)`);
  estilo.setProperty('--cor-primaria-suave', `color-mix(in srgb, ${primaria} 14%, var(--cor-superficie))`);
  estilo.setProperty('--cor-azul-suave', `color-mix(in srgb, ${primaria} 14%, var(--cor-superficie))`);
  estilo.setProperty('--gradiente-primario', `linear-gradient(135deg, ${primaria}, color-mix(in srgb, ${primaria} 82%, black))`);
  estilo.setProperty('--sombra-primaria', `0 6px 16px color-mix(in srgb, ${primaria} 30%, transparent)`);
}

function aplicarTituloEIcones(plataforma: Plataforma): void {
  document.title = plataforma.nome;
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => {
      link.href = LOGO_SRC;
    });
}

export interface ValorPlataforma {
  plataforma: Plataforma;
  logoSrc: string;
  recarregar: () => Promise<void>;
}

const PlataformaContexto = createContext<ValorPlataforma>({
  plataforma: PLATAFORMA_PADRAO,
  logoSrc: LOGO_SRC,
  recarregar: async () => undefined,
});

export function PlataformaProvider({ children }: { children: ReactNode }) {
  const [plataforma, setPlataforma] = useState<Plataforma>(() => lerGuardada() ?? PLATAFORMA_PADRAO);

  const recarregar = useCallback(async () => {
    try {
      const dados = await api.get<Partial<Plataforma>>('/plataforma');
      const nova = normalizar(dados);
      setPlataforma(nova);
      gravarNoNavegador(nova);
    } catch {
      // Sem resposta do servidor, segue com o que já está guardado.
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  useEffect(() => {
    aplicarCor(plataforma);
    aplicarTituloEIcones(plataforma);
  }, [plataforma]);

  const valor = useMemo<ValorPlataforma>(
    () => ({ plataforma, logoSrc: LOGO_SRC, recarregar }),
    [plataforma, recarregar],
  );

  return <PlataformaContexto.Provider value={valor}>{children}</PlataformaContexto.Provider>;
}

export function usePlataforma(): ValorPlataforma {
  return useContext(PlataformaContexto);
}
