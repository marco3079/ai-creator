import { lazy } from 'react';
import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import './modelos.css';

const DetalheModelo = lazy(() => import('./Detalhe').then((m) => ({ default: m.DetalheModelo })));
const Lista = lazy(() => import('./Lista').then((m) => ({ default: m.Lista })));
const NovoModelo = lazy(() => import('./NovoModelo').then((m) => ({ default: m.NovoModelo })));

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
