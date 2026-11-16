import { lazy } from 'react';
import type { RotaModulo } from '../../lib/rotas';
import './firmware.css';

const Projetos = lazy(() => import('./Projetos').then((m) => ({ default: m.Projetos })));
const EditorProjeto = lazy(() => import('./EditorProjeto').then((m) => ({ default: m.EditorProjeto })));
const Compilacoes = lazy(() => import('./Compilacoes').then((m) => ({ default: m.Compilacoes })));
const Dispositivos = lazy(() => import('./Dispositivos').then((m) => ({ default: m.Dispositivos })));
const DetalheDispositivo = lazy(() =>
  import('./DetalheDispositivo').then((m) => ({ default: m.DetalheDispositivo })),
);
const MonitorSerialPagina = lazy(() =>
  import('./MonitorSerial').then((m) => ({ default: m.MonitorSerialPagina })),
);
const Coleta = lazy(() => import('./Coleta').then((m) => ({ default: m.Coleta })));

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
    rotulo: 'Frota',
    icone: 'chip',
    perfis: [...TODOS],
    elemento: <Dispositivos />,
    ordem: 22,
  },
  {
    caminho: '/app/dispositivos/:id',
    rotulo: 'Dispositivo',
    icone: 'chip',
    perfis: [...TODOS],
    elemento: <DetalheDispositivo />,
    menu: false,
  },
  {
    caminho: '/app/serial',
    rotulo: 'Monitor serial',
    icone: 'terminal',
    perfis: [...TODOS],
    elemento: <MonitorSerialPagina />,
    ordem: 23,
  },
  {
    caminho: '/app/coleta',
    rotulo: 'Coletar dados',
    icone: 'upload',
    perfis: ['ADMIN', 'DEV'],
    elemento: <Coleta />,
    ordem: 31,
  },
];
