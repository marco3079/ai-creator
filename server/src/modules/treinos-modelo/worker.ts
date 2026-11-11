import { config } from '../../lib/config';
import { sincronizarAjustesOpenai } from './openai';

// Verifica a OpenAI a cada 30 s os treinos LLM_NUVEM em execução.
const INTERVALO_MS = 30_000;

let iniciado = false; // impede que dois timers sejam criados
let rodando = false; // impede ciclos sobrepostos

async function ciclo(): Promise<void> {
  // Sem chave não há o que sincronizar.
  if (!config.openaiChave || rodando) return;
  rodando = true;
  try {
    await sincronizarAjustesOpenai();
  } catch (erro) {
    console.error('[worker-openai] falha no ciclo de sincronização:', erro);
  } finally {
    rodando = false;
  }
}

export function iniciarWorkerOpenai(): void {
  if (iniciado) return;
  iniciado = true;
  setInterval(() => {
    void ciclo();
  }, INTERVALO_MS);
}
