// Tipos da frota / OTA (fonte: docs/plano/CONTRATOS-LEVA-B.md). Escrito pelo main; os geradores só importam.
import type { Placa } from './tipos-api';

export interface TelemetriaPlaca {
  rssi?: number; // dBm do Wi-Fi
  heapLivre?: number; // bytes
  uptimeS?: number;
  temperatura?: number; // °C interna, quando a placa informa
  versao?: number; // AIC_BUILD_ID do firmware em execução
  [chave: string]: unknown; // valores extras que o firmware do usuário publicar
}

export interface DispositivoFrota {
  id: number;
  nome: string;
  placa: Placa;
  porta: string;
  notas: string;
  projetoId: number | null;
  projeto: { id: number; nome: string } | null;
  chavePrefixo: string | null; // null = sem chave (ainda não configurado para OTA)
  online: boolean;
  ultimoContato: string | null;
  ip: string | null;
  telemetria: TelemetriaPlaca | null;
  buildAtualId: number | null;
  buildAlvoId: number | null;
  ultimaOta: string | null;
  statusOta: string | null;
  ultimoBuildId: number | null;
  ultimaGravacao: string | null;
  criadoEm: string;
}

export interface AmostraTelemetria {
  em: string;
  dados: TelemetriaPlaca;
}

// Resposta de POST /dispositivos/:id/chave (a chave em claro aparece só aqui).
export interface ChaveGerada {
  chave: string; // "aicd_<40 hex>"
  prefixo: string;
}
