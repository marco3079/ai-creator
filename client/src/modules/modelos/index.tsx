import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import { DetalheModelo } from './Detalhe';
import { Lista } from './Lista';
import { NovoModelo } from './NovoModelo';
import './modelos.css';

const PERFIS: Perfil[] = ['ADMIN', 'DEV', 'LEITOR'];

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/modelos',
    rotulo: 'Modelos',
    icone: 'laboratorio',
    perfis: PERFIS,
    elemento: <Lista />,
    ordem: 15,
  },
  {
    caminho: '/app/modelos/novo',
    rotulo: 'Novo modelo',
    icone: 'laboratorio',
    perfis: PERFIS,
    elemento: <NovoModelo />,
    menu: false,
  },
  {
    caminho: '/app/modelos/:id',
    rotulo: 'Modelo',
    icone: 'laboratorio',
    perfis: PERFIS,
    elemento: <DetalheModelo />,
    menu: false,
  },
];
