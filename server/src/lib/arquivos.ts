import fs from 'fs';
import path from 'path';
import { config } from './config';

// Caminho dentro de DATA_DIR; cria o diretório pai se não existir.
export function caminhoDados(...partes: string[]): string {
  const caminho = path.join(config.dataDir, ...partes);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  return caminho;
}
