import { Request, Response, NextFunction, RequestHandler } from 'express';

export class ErroHttp extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroHttp';
  }
}

// Repassa erros de funções assíncronas ao tratador de erros do app.
export function rota(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Lê o parâmetro numérico :id da rota (400 se não for inteiro positivo).
export function idParam(req: Request, nome = 'id'): number {
  const bruto = req.params[nome];
  if (typeof bruto !== 'string' || !/^\d+$/.test(bruto)) {
    throw new ErroHttp(400, 'Id inválido');
  }
  const id = Number(bruto);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ErroHttp(400, 'Id inválido');
  }
  return id;
}
