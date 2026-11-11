import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import { Editor } from './Editor';
import { Lista } from './Lista';
import './agentes.css';

const PERFIS: Perfil[] = ['ADMIN', 'DEV', 'LEITOR'];

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/agentes',
    rotulo: 'Agentes LLM',
    icone: 'robo',
    perfis: PERFIS,
    elemento: <Lista tipo="LLM" />,
    ordem: 10,
  },
  {
    caminho: '/app/tinyml',
    rotulo: 'Agentes TinyML',
    icone: 'cerebro',
    perfis: PERFIS,
    elemento: <Lista tipo="TINYML" />,
    ordem: 11,
  },
  {
    caminho: '/app/agentes/novo',
    rotulo: 'Novo agente',
    icone: 'robo',
    perfis: PERFIS,
    elemento: <Editor />,
    menu: false,
  },
  {
    caminho: '/app/agentes/:id',
    rotulo: 'Agente',
    icone: 'robo',
    perfis: PERFIS,
    elemento: <Editor />,
    menu: false,
  },
];
