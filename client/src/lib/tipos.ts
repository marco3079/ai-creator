export type Perfil = 'ADMIN' | 'DEV' | 'LEITOR';

export interface UsuarioLogado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
}

// Nomes de perfil mostrados na tela (menu do usuário e cabeçalho).
export const NOME_PERFIL: Record<Perfil, string> = {
  ADMIN: 'Administrador',
  DEV: 'Desenvolvedor',
  LEITOR: 'Leitor',
};
