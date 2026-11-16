import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { criarApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

// Utilitários dos testes de API. O banco é o apontado por DATABASE_URL (ver vitest.config.ts).

export const EMAIL_ADMIN = 'admin-teste@aicreator.local';
export const SENHA_TESTE = 'senha-teste-123';

let appCache: Express | null = null;

// Uma instância do app por processo de teste.
export async function app(): Promise<Express> {
  if (!appCache) appCache = await criarApp();
  return appCache;
}

// Esvazia todas as tabelas do schema public (exceto o histórico do Prisma). Só para o banco de teste.
export async function limparBanco(): Promise<void> {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tabelas.length === 0) return;
  const lista = tabelas.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

// Cria um usuário direto no banco (ignora a API, usado para montar o cenário).
export async function criarUsuarioNoBanco(
  perfil: 'ADMIN' | 'DEV' | 'LEITOR',
  email: string,
  senha = SENHA_TESTE,
): Promise<{ id: number; email: string; senha: string }> {
  const usuario = await prisma.usuario.create({
    data: {
      nome: `Usuário ${perfil}`,
      email,
      senhaHash: await bcrypt.hash(senha, 4),
      perfil,
    },
  });
  return { id: usuario.id, email, senha };
}

// Esvazia o banco e cria o administrador de teste. Devolve o JWT dele.
export async function prepararAdmin(): Promise<string> {
  await limparBanco();
  await criarUsuarioNoBanco('ADMIN', EMAIL_ADMIN);
  return entrar(EMAIL_ADMIN, SENHA_TESTE);
}

// Login pela API. Lança se não der 200 (use direto em beforeAll).
export async function entrar(email: string, senha: string): Promise<string> {
  const resposta = await request(await app())
    .post('/api/auth/login')
    .send({ email, senha });
  if (resposta.status !== 200) {
    throw new Error(`Login de teste falhou (${resposta.status}): ${JSON.stringify(resposta.body)}`);
  }
  return resposta.body.token as string;
}

// Cabeçalho Authorization para usar com supertest.
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// CSV de tabela válido com duas classes (rotulo + 2 atributos numéricos).
export const CSV_TABELA_VALIDO = 'rotulo,x,y\nA,1,2\nA,1.5,2.5\nB,3,4\nB,3.5,4.5\n';

// Cria um dataset TABELA pela API e devolve o registro.
export async function criarDatasetTabela(token: string, nome = 'Dataset de teste'): Promise<{ id: number }> {
  const resposta = await request(await app())
    .post('/api/datasets')
    .set(bearer(token))
    .send({ nome, tipo: 'TABELA', csv: CSV_TABELA_VALIDO });
  if (resposta.status !== 201) {
    throw new Error(`Criação do dataset de teste falhou (${resposta.status}): ${JSON.stringify(resposta.body)}`);
  }
  return resposta.body as { id: number };
}
