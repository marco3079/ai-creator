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

const barramento = new EventEmitter();
barramento.setMaxListeners(0);

// Publica uma mudança de status ou de log/métricas de um trabalho. Carimba o horário.
export function emitirEvento(evento: Omit<EventoTrabalho, 'em'>): void {
  const completo: EventoTrabalho = { ...evento, em: new Date().toISOString() };
  barramento.emit('evento', completo);
}

// Assina os eventos. Devolve a função que remove o ouvinte.
export function ouvirEventos(fn: (evento: EventoTrabalho) => void): () => void {
  barramento.on('evento', fn);
  return () => {
    barramento.off('evento', fn);
  };
}
