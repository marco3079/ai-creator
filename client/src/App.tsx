import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { caminhoDoPerfil, Layout } from './layout/Layout';
import { Login } from './layout/Login';
import { Pagina } from './ui';
import type { RotaModulo } from './lib/rotas';
import type { Perfil } from './lib/tipos';

// Junta as rotas de todos os módulos em src/modules/<modulo>/index.tsx
const modulos = import.meta.glob<{ rotas: RotaModulo[] }>('./modules/*/index.tsx', {
  eager: true,
});

const ROTAS: RotaModulo[] = Object.values(modulos)
  .flatMap((m) => m.rotas)
  .sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));

function LayoutDoPerfil() {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  const menu = ROTAS.filter((r) => r.perfis.includes(usuario.perfil) && r.menu !== false);
  return <Layout menu={menu} />;
}

function RotaProtegida({ perfis, children }: { perfis: Perfil[]; children: ReactNode }) {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  if (!perfis.includes(usuario.perfil)) {
    return <Navigate to={caminhoDoPerfil(usuario.perfil)} replace />;
  }
  return <>{children}</>;
}

function Raiz() {
  const { usuario } = useAuth();
  return <Navigate to={usuario ? caminhoDoPerfil(usuario.perfil) : '/login'} replace />;
}

function NaoEncontrada() {
  const { usuario } = useAuth();
  const inicio = usuario ? caminhoDoPerfil(usuario.perfil) : '/login';
  return (
    <Pagina titulo="Página não encontrada">
      <p>O endereço que você abriu não existe.</p>
      <Link className="botao botao-primario" to={inicio}>
        Ir para o início
      </Link>
    </Pagina>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Raiz />} />
      <Route element={<LayoutDoPerfil />}>
        {ROTAS.map((r) => (
          <Route
            key={r.caminho}
            path={r.caminho}
            element={<RotaProtegida perfis={r.perfis}>{r.elemento}</RotaProtegida>}
          />
        ))}
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  );
}
