import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ZodError } from 'zod';
import { ErroHttp } from './lib/erros';

// Lê a pasta modules e monta o router de cada módulo (routes.ts) em /api.
async function montarModulos(app: Express): Promise<void> {
  const dirModulos = path.join(__dirname, 'modules');
  const pastas = fs
    .readdirSync(dirModulos, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();

  for (const pasta of pastas) {
    const arquivo = ['routes.ts', 'routes.js']
      .map((nome) => path.join(dirModulos, pasta, nome))
      .find((caminho) => fs.existsSync(caminho));
    if (!arquivo) {
      continue;
    }
    const modulo = await import(pathToFileURL(arquivo).href);
    app.use('/api', modulo.default);
  }
}

function tratarErro(erro: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (erro instanceof ErroHttp) {
    res.status(erro.status).json({ erro: erro.message });
    return;
  }
  if (erro instanceof ZodError) {
    const primeira = erro.issues[0];
    res.status(400).json({ erro: primeira ? primeira.message : 'Dados inválidos' });
    return;
  }
  const tipo = (erro as { type?: string })?.type;
  if (tipo === 'entity.parse.failed') {
    res.status(400).json({ erro: 'JSON inválido' });
    return;
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({ erro: 'Corpo da requisição grande demais' });
    return;
  }
  console.error(`Erro em ${req.method} ${req.originalUrl}:`, erro);
  res.status(500).json({ erro: 'Erro interno' });
}

export async function criarApp(): Promise<Express> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));

  await montarModulos(app);

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  app.use(tratarErro);
  return app;
}
