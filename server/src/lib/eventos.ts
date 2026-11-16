import { EventEmitter } from 'node:events';

// Eventos ao vivo dos trabalhos (CONTRATOS-MELHORIAS §2). Mesmo formato de client/src/lib/tipos-melhorias.ts.
export type TipoTrabalho = 'treino' | 'treinoModelo' | 'build';

export type StatusTrabalho = 'FILA' | 'EXECUTANDO' | 'SUCESSO' | 'FALHA' | 'CANCELADO';

export interface EventoTrabalho {
  tipo: TipoTrabalho;
  id: number;
  status: StatusTrabalho;
  agenteId?: number | null; // treino (agente TinyML)
  modeloId?: number | null; // treinoModelo
  projetoId?: number | null; // build
  em: string; // ISO
}

// Estado de um dispositivo da frota (leva B). id = dispositivo.
export interface EventoDispositivo {
  tipo: 'dispositivo';
  id: number;
  online: boolean;
  statusOta: string | null;
  em?: string; // carimbado por emitirEvento
}

export type EventoServidor = EventoTrabalho | EventoDispositivo;

// Evento sem o horário (que emitirEvento carimba). Distribui sobre a união.
type SemEm<T> = T extends unknown ? Omit<T, 'em'> : never;

const barramento = new EventEmitter();
barramento.setMaxListeners(0);

// Publica uma mudança de status ou de log/métricas de um trabalho (ou de um dispositivo). Carimba o horário.
export function emitirEvento(evento: SemEm<EventoServidor>): void {
  const completo = { ...evento, em: new Date().toISOString() } as EventoServidor;
  barramento.emit('evento', completo);
}

// Assina os eventos. Devolve a função que remove o ouvinte.
export function ouvirEventos(fn: (evento: EventoServidor) => void): () => void {
  barramento.on('evento', fn);
  return () => {
    barramento.off('evento', fn);
  };
}
