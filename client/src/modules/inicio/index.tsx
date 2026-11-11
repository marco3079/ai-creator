import type { RotaModulo } from '../../lib/rotas';
import { Painel } from './Painel';

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
