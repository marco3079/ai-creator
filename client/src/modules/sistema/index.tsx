import { lazy } from 'react';
import type { RotaModulo } from '../../lib/rotas';
import './sistema.css';

const Configuracoes = lazy(() => import('./Configuracoes').then((m) => ({ default: m.Configuracoes })));
const Integracoes = lazy(() => import('./Integracoes').then((m) => ({ default: m.Integracoes })));
const Logs = lazy(() => import('./Logs').then((m) => ({ default: m.Logs })));
const Tokens = lazy(() => import('./Tokens').then((m) => ({ default: m.Tokens })));
const Usuarios = lazy(() => import('./Usuarios').then((m) => ({ default: m.Usuarios })));
const Uso = lazy(() => import('./Uso').then((m) => ({ default: m.Uso })));

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/integracoes',
    rotulo: 'VS Code e Claude Code',
    icone: 'plugin',
    perfis: ['ADMIN', 'DEV', 'LEITOR'],
    elemento: <Integracoes />,
    ordem: 40,
  },
  {
    caminho: '/app/usuarios',
    rotulo: 'Usuários',
    icone: 'usuarios',
    perfis: ['ADMIN'],
    elemento: <Usuarios />,
    ordem: 50,
  },
  {
    caminho: '/app/logs',
    rotulo: 'Logs',
    icone: 'log',
    perfis: ['ADMIN'],
    elemento: <Logs />,
    ordem: 51,
  },
  {
    caminho: '/app/configuracoes',
    rotulo: 'Configurações',
    icone: 'engrenagem',
    perfis: ['ADMIN'],
    elemento: <Configuracoes />,
    ordem: 52,
  },
  {
    caminho: '/app/uso',
    rotulo: 'Uso e custos',
    icone: 'grafico',
    perfis: ['ADMIN', 'DEV'],
    elemento: <Uso />,
    ordem: 53,
  },
  {
    caminho: '/app/tokens',
    rotulo: 'Tokens de API',
    icone: 'chave',
    perfis: ['ADMIN', 'DEV', 'LEITOR'],
    elemento: <Tokens />,
    ordem: 60,
  },
];
