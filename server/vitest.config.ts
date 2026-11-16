import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

// Testes de API: rodam contra o Postgres apontado por DATABASE_URL (no CI, serviço postgres 16).
// Os arquivos rodam em sequência (um banco compartilhado) e sem fila nem vigia em background.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      FILA_DESLIGADA: '1',
      JWT_SECRET: 'segredo-de-teste-nao-usar-em-producao',
      INTERNO_TOKEN: 'token-interno-de-teste',
      DATA_DIR: path.join(os.tmpdir(), 'ai-creator-testes'),
      ADMIN_EMAIL: 'admin-teste@aicreator.local',
      ADMIN_SENHA: 'senha-teste-123',
    },
  },
});
