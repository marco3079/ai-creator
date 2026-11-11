import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from './prisma';
import { config } from './config';

export interface UsuarioReq {
  id: number;
  nome: string;
  email: string;
  perfil: 'ADMIN' | 'DEV' | 'LEITOR';
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioReq;
    }
  }
}

function recusar(res: Response): void {
  res.status(401).json({ erro: 'Não autenticado' });
}

// Aceita JWT (Bearer <jwt>) ou token de API (Bearer aic_<token>). Recarrega o usuário do banco
// e recusa usuário inativo ou token revogado.
export const autenticar: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cabecalho = req.headers.authorization ?? '';
    if (!cabecalho.startsWith('Bearer ')) {
      recusar(res);
      return;
    }
    const token = cabecalho.slice('Bearer '.length).trim();

    let usuario: { id: number; nome: string; email: string; perfil: UsuarioReq['perfil']; ativo: boolean } | null = null;

    if (token.startsWith('aic_')) {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const registro = await prisma.tokenApi.findUnique({ where: { hash }, include: { usuario: true } });
      if (!registro || registro.revogado) {
        recusar(res);
        return;
      }
      await prisma.tokenApi.update({ where: { id: registro.id }, data: { ultimoUso: new Date() } });
      usuario = registro.usuario;
    } else {
      let payload: jwt.JwtPayload;
      try {
        payload = jwt.verify(token, config.jwtSegredo) as jwt.JwtPayload;
      } catch {
        recusar(res);
        return;
      }
      usuario = await prisma.usuario.findUnique({ where: { id: Number(payload.id) } });
    }

    if (!usuario || !usuario.ativo) {
      recusar(res);
      return;
    }
    req.usuario = { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil };
    next();
  } catch (erro) {
    next(erro);
  }
};

// Exige um dos perfis informados (403 se o usuário não tiver).
export function exigirPerfil(...perfis: UsuarioReq['perfil'][]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) {
      recusar(res);
      return;
    }
    if (!perfis.includes(req.usuario.perfil)) {
      res.status(403).json({ erro: 'Sem permissão' });
      return;
    }
    next();
  };
}

// Comparação em tempo constante do header X-Interno-Token com INTERNO_TOKEN.
export const exigirInterno: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const recebido = Buffer.from(String(req.headers['x-interno-token'] ?? ''));
  const esperado = Buffer.from(config.internoToken);
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  next();
};

// JWT de sessão, expira em 12 horas.
export function assinarJwt(u: UsuarioReq): string {
  return jwt.sign({ id: u.id }, config.jwtSegredo, { expiresIn: '12h' });
}
