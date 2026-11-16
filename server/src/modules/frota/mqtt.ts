import mqtt, { MqttClient } from 'mqtt';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { chaveConfere, emitirDispositivo } from './comum';
import type { TelemetriaPlaca } from './comum';

// Broker MQTT da frota (CONTRATOS-LEVA-B §2). Sem MQTT_URL não conecta; os erros só são registrados.
const TOPICO_RE = /^aic\/d\/(\d+)\/(telemetria|status)$/;
const SEG_AMOSTRA_MS = 30_000;
const VIGIA_MS = 60_000;
const LIMITE_CONTATO_MS = 60_000;
const RETENCAO_MS = 7 * 24 * 3600 * 1000;
const LIMPEZA_MS = 24 * 3600 * 1000;

let cliente: MqttClient | null = null;
let iniciado = false;

// Hash da chave por dispositivo (cache em memória; invalidado quando uma chave nova é gerada).
const cacheHash = new Map<number, string | null>();
const ultimaAmostra = new Map<number, number>();

export function invalidarChaveDispositivo(id: number): void {
  cacheHash.delete(id);
}

// Lê "aic/d/<id>/<tipo>". Devolve null se o tópico não for da frota.
export function lerTopico(topico: string): { id: number; tipo: 'telemetria' | 'status' } | null {
  const m = TOPICO_RE.exec(topico);
  if (!m) {
    return null;
  }
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return { id, tipo: m[2] as 'telemetria' | 'status' };
}

// Separa a chave do restante do JSON de telemetria. Null se não for um objeto com "chave" texto.
export function lerTelemetria(texto: string): { chave: string; dados: TelemetriaPlaca } | null {
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return null;
  }
  const { chave, ...dados } = corpo as Record<string, unknown>;
  if (typeof chave !== 'string') {
    return null;
  }
  return { chave, dados: dados as TelemetriaPlaca };
}

async function hashDoDispositivo(id: number): Promise<string | null> {
  if (cacheHash.has(id)) {
    return cacheHash.get(id) ?? null;
  }
  const dispositivo = await prisma.dispositivo.findUnique({ where: { id }, select: { chaveHash: true } });
  if (!dispositivo) {
    return null;
  }
  cacheHash.set(id, dispositivo.chaveHash);
  return dispositivo.chaveHash;
}

async function tratarTelemetria(id: number, texto: string): Promise<void> {
  const leitura = lerTelemetria(texto);
  if (!leitura) {
    return;
  }
  // Chave errada: descarta sem gravar nada.
  if (!chaveConfere(leitura.chave, await hashDoDispositivo(id))) {
    return;
  }
  const versao = leitura.dados.versao;
  const buildAtualId = typeof versao === 'number' && Number.isSafeInteger(versao) && versao > 0 ? versao : undefined;
  const dados = leitura.dados as Prisma.InputJsonValue;
  await prisma.dispositivo.update({
    where: { id },
    data: { online: true, ultimoContato: new Date(), telemetria: dados, buildAtualId },
  });

  const agora = Date.now();
  if (agora - (ultimaAmostra.get(id) ?? 0) >= SEG_AMOSTRA_MS) {
    ultimaAmostra.set(id, agora);
    await prisma.telemetriaDispositivo.create({ data: { dispositivoId: id, dados } });
  }
  await emitirDispositivo(id);
}

async function tratarStatus(id: number, texto: string): Promise<void> {
  if (texto !== 'online' && texto !== 'offline') {
    return;
  }
  const online = texto === 'online';
  const { count } = await prisma.dispositivo.updateMany({
    where: { id },
    data: online ? { online, ultimoContato: new Date() } : { online },
  });
  if (count > 0) {
    await emitirDispositivo(id);
  }
}

// Trata uma mensagem recebida. Chamada pelo cliente MQTT; exceções são só registradas.
export async function tratarMensagem(topico: string, texto: string): Promise<void> {
  const alvo = lerTopico(topico);
  if (!alvo) {
    return;
  }
  if (alvo.tipo === 'status') {
    await tratarStatus(alvo.id, texto.trim());
    return;
  }
  await tratarTelemetria(alvo.id, texto);
}

// Publica um comando (atualizar/reiniciar). Devolve false se o broker não estiver conectado.
export function publicarComando(id: number, acao: 'atualizar' | 'reiniciar'): boolean {
  if (!cliente || !cliente.connected) {
    return false;
  }
  cliente.publish(`aic/d/${id}/comando`, JSON.stringify({ acao }), { qos: 1 }, (erro) => {
    if (erro) {
      console.error('MQTT: falha ao publicar comando:', erro.message);
    }
  });
  return true;
}

async function vigiar(): Promise<void> {
  const limite = new Date(Date.now() - LIMITE_CONTATO_MS);
  const vencidos = await prisma.dispositivo.findMany({
    where: { online: true, ultimoContato: { lt: limite } },
    select: { id: true },
  });
  if (vencidos.length === 0) {
    return;
  }
  const ids = vencidos.map((v) => v.id);
  await prisma.dispositivo.updateMany({ where: { id: { in: ids } }, data: { online: false } });
  for (const id of ids) {
    await emitirDispositivo(id);
  }
}

async function limpar(): Promise<void> {
  await prisma.telemetriaDispositivo.deleteMany({
    where: { criadoEm: { lt: new Date(Date.now() - RETENCAO_MS) } },
  });
}

// Inicia a conexão MQTT, a vigia e a limpeza diária. Idempotente.
export function iniciarMqtt(): void {
  if (iniciado) {
    return;
  }
  iniciado = true;

  const vigia = setInterval(() => {
    vigiar().catch((erro) => console.error('Vigia da frota:', erro instanceof Error ? erro.message : erro));
  }, VIGIA_MS);
  vigia.unref();

  const faxina = setInterval(() => {
    limpar().catch((erro) => console.error('Limpeza de telemetria:', erro instanceof Error ? erro.message : erro));
  }, LIMPEZA_MS);
  faxina.unref();

  if (!config.mqttUrl) {
    console.log('MQTT: MQTT_URL não definido; a frota não conecta no broker.');
    return;
  }

  cliente = mqtt.connect(config.mqttUrl, {
    username: config.mqttUsuario || undefined,
    password: config.mqttSenha || undefined,
    reconnectPeriod: 5000,
  });
  cliente.on('connect', () => {
    console.log('MQTT conectado');
    cliente?.subscribe(['aic/d/+/telemetria', 'aic/d/+/status'], { qos: 1 }, (erro) => {
      if (erro) {
        console.error('MQTT: falha ao assinar os tópicos:', erro.message);
      }
    });
  });
  cliente.on('error', (erro) => {
    console.error('MQTT:', erro.message);
  });
  cliente.on('message', (topico, payload) => {
    tratarMensagem(topico, payload.toString('utf8')).catch((erro) => {
      console.error('MQTT: mensagem não processada:', erro instanceof Error ? erro.message : erro);
    });
  });
}
