import { lazy } from 'react';
import type { RotaModulo } from '../../lib/rotas';
import './tinyml.css';

const Datasets = lazy(() => import('./Datasets').then((m) => ({ default: m.Datasets })));

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/datasets',
    rotulo: 'Datasets',
    icone: 'dados',
    perfis: ['ADMIN', 'DEV', 'LEITOR'],
    elemento: <Datasets />,
    ordem: 30,
  },
];
