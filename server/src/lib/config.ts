import path from 'path';

// Variáveis de ambiente do server (ver CONTRATOS §1). Padrões de dev; no Docker, DATA_DIR=/data.
export const config = {
  porta: Number(process.env.PORT ?? 3333),
  jwtSegredo: process.env.JWT_SECRET ?? 'troque-este-segredo',
  dataDir: process.env.DATA_DIR ?? path.resolve('dados'),
  trainerUrl: process.env.TRAINER_URL ?? 'http://trainer:8001',
  builderUrl: process.env.BUILDER_URL ?? 'http://builder:8002',
  serverUrlInterno: process.env.SERVER_URL_INTERNO ?? 'http://server:3333',
  internoToken: process.env.INTERNO_TOKEN ?? 'troque-token-interno',
  openaiChave: process.env.OPENAI_API_KEY ?? '',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://ollama:11434',
};
