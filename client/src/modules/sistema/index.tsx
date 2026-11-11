import type { RotaModulo } from '../../lib/rotas';
import { Configuracoes } from './Configuracoes';
import { Integracoes } from './Integracoes';
import { Logs } from './Logs';
import { Tokens } from './Tokens';
import { Usuarios } from './Usuarios';
import './sistema.css';

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
    caminho: '/app/tokens',
    rotulo: 'Tokens de API',
    icone: 'chave',
    perfis: ['ADMIN', 'DEV', 'LEITOR'],
    elemento: <Tokens />,
    ordem: 60,
  },
];
