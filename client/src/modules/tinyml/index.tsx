import type { RotaModulo } from '../../lib/rotas';
import { Datasets } from './Datasets';
import './tinyml.css';

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
