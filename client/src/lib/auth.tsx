import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { UsuarioLogado } from './tipos';

const CHAVE_TOKEN = 'aicreator.token';
const CHAVE_USUARIO = 'aicreator.usuario';

interface AuthContexto {
  usuario: UsuarioLogado | null;
  entrar(email: string, senha: string): Promise<void>;
  sair(): void;
}

const Contexto = createContext<AuthContexto | null>(null);

function lerUsuarioSalvo(): UsuarioLogado | null {
  try {
    const bruto = localStorage.getItem(CHAVE_USUARIO);
    return bruto ? (JSON.parse(bruto) as UsuarioLogado) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(() =>
    localStorage.getItem(CHAVE_TOKEN) ? lerUsuarioSalvo() : null,
  );

  async function entrar(email: string, senha: string): Promise<void> {
    const resposta = await api.post<{ token: string; usuario: UsuarioLogado }>('/auth/login', {
      email,
      senha,
    });
    localStorage.setItem(CHAVE_TOKEN, resposta.token);
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(resposta.usuario));
    setUsuario(resposta.usuario);
  }

  function sair(): void {
    // Avisa o servidor antes de limpar o token (o cabeçalho Authorization é lido agora). Sem esperar a resposta.
    api.post('/auth/sair').catch(() => undefined);
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_USUARIO);
    setUsuario(null);
  }

  return <Contexto.Provider value={{ usuario, entrar, sair }}>{children}</Contexto.Provider>;
}

export function useAuth(): AuthContexto {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return contexto;
}
