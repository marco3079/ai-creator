import path from 'path';
import { segredo } from './segredos';

// Variáveis de ambiente do server (ver CONTRATOS §1). Padrões de dev; no Docker, DATA_DIR=/data.
export const config = {
  porta: Number(process.env.PORT ?? 3333),
  jwtSegredo: segredo('JWT_SECRET'),
  dataDir: process.env.DATA_DIR ?? path.resolve('dados'),
  trainerUrl: process.env.TRAINER_URL ?? 'http://trainer:8001',
  builderUrl: process.env.BUILDER_URL ?? 'http://builder:8002',
  serverUrlInterno: process.env.SERVER_URL_INTERNO ?? 'http://server:3333',
  internoToken: segredo('INTERNO_TOKEN'),
  openaiChave: process.env.OPENAI_API_KEY ?? '',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://ollama:11434',
  finetunerUrl: process.env.FINETUNER_URL ?? 'http://finetuner:8003',
  // Frota / OTA (leva B). MQTT_URL vazia = não conecta no broker.
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://mosquitto:1883', // MQTT_URL definida e vazia desliga o broker
  mqttUsuario: process.env.MQTT_USUARIO ?? '',
  mqttSenha: process.env.MQTT_SENHA ?? '',
  mqttHostPublico: process.env.MQTT_HOST_PUBLICO ?? '',
  mqttPorta: Number(process.env.MQTT_PORTA ?? 1883),
  servidorUrlPublica: process.env.SERVIDOR_URL_PUBLICA ?? '',
};
