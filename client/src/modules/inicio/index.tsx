import { lazy } from 'react';
import type { RotaModulo } from '../../lib/rotas';

const Painel = lazy(() => import('./Painel').then((m) => ({ default: m.Painel })));

export const rotas: RotaModulo[] = [
  {
    caminho: '/app',
    rotulo: 'Início',
    icone: 'inicio',
    perfis: ['ADMIN', 'DEV', 'LEITOR'],
    elemento: <Painel />,
    ordem: 0,
  },
];
