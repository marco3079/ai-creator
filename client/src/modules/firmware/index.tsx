import type { RotaModulo } from '../../lib/rotas';
import { Projetos } from './Projetos';
import { EditorProjeto } from './EditorProjeto';
import { Compilacoes } from './Compilacoes';
import { Dispositivos } from './Dispositivos';
import './firmware.css';

const TODOS = ['ADMIN', 'DEV', 'LEITOR'] as const;

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/projetos',
    rotulo: 'Projetos',
    icone: 'pasta',
    perfis: [...TODOS],
    elemento: <Projetos />,
    ordem: 20,
  },
  {
    caminho: '/app/projetos/:id',
    rotulo: 'Projeto',
    icone: 'pasta',
    perfis: [...TODOS],
    elemento: <EditorProjeto />,
    menu: false,
  },
  {
    caminho: '/app/builds',
    rotulo: 'Compilações',
    icone: 'martelo',
    perfis: [...TODOS],
    elemento: <Compilacoes />,
    ordem: 21,
  },
  {
    caminho: '/app/dispositivos',
    rotulo: 'Dispositivos',
    icone: 'chip',
    perfis: [...TODOS],
    elemento: <Dispositivos />,
    ordem: 22,
  },
];
