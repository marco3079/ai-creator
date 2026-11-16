import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  EMAIL_ADMIN,
  SENHA_TESTE,
  app,
  bearer,
  criarUsuarioNoBanco,
  entrar,
  prepararAdmin,
} from './ajuda';

let tokenAdmin = '';

beforeAll(async () => {
  tokenAdmin = await prepararAdmin();
});

describe('login', () => {
  it('entra com e-mail e senha corretos e devolve token e usuário', async () => {
    const res = await request(await app())
      .post('/api/auth/login')
      .send({ email: EMAIL_ADMIN, senha: SENHA_TESTE });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.usuario).toMatchObject({ email: EMAIL_ADMIN, perfil: 'ADMIN' });
    expect(res.body.usuario).not.toHaveProperty('senhaHash');
  });

  it('recusa senha errada com 401 e mensagem', async () => {
    const res = await request(await app())
      .post('/api/auth/login')
      .send({ email: EMAIL_ADMIN, senha: 'errada-123' });

    expect(res.status).toBe(401);
    expect(res.body.erro).toBeTruthy();
  });

  it('recusa e-mail inexistente com 401', async () => {
    const res = await request(await app())
      .post('/api/auth/login')
      .send({ email: 'ninguem@aicreator.local', senha: SENHA_TESTE });

    expect(res.status).toBe(401);
  });

  it('rejeita corpo sem senha com 400', async () => {
    const res = await request(await app()).post('/api/auth/login').send({ email: EMAIL_ADMIN });

    expect(res.status).toBe(400);
    expect(res.body.erro).toBeTruthy();
  });
});

describe('autenticação das rotas', () => {
  it('rota protegida sem token responde 401', async () => {
    const res = await request(await app()).get('/api/agentes');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: 'Não autenticado' });
  });

  it('token inválido responde 401', async () => {
    const res = await request(await app())
      .get('/api/agentes')
      .set(bearer('isto-nao-e-um-jwt'));
    expect(res.status).toBe(401);
  });

  it('token de API revogado não autentica', async () => {
    const criado = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Token a revogar' });
    expect(criado.status).toBe(201);

    const revogado = await request(await app())
      .delete(`/api/tokens/${criado.body.registro.id}`)
      .set(bearer(tokenAdmin));
    expect(revogado.status).toBe(204);

    const res = await request(await app())
      .get('/api/agentes')
      .set(bearer(criado.body.token));
    expect(res.status).toBe(401);
  });

  it('GET /auth/eu devolve o usuário logado', async () => {
    const res = await request(await app()).get('/api/auth/eu').set(bearer(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.usuario).toMatchObject({ email: EMAIL_ADMIN, perfil: 'ADMIN' });
  });
});

describe('perfil LEITOR', () => {
  let tokenLeitor = '';

  beforeAll(async () => {
    const criado = await request(await app())
      .post('/api/usuarios')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Leitora', email: 'leitora@aicreator.local', senha: SENHA_TESTE, perfil: 'LEITOR' });
    expect(criado.status).toBe(201);
    tokenLeitor = await entrar('leitora@aicreator.local', SENHA_TESTE);
  });

  it('LEITOR lê a lista de agentes', async () => {
    const res = await request(await app()).get('/api/agentes').set(bearer(tokenLeitor));
    expect(res.status).toBe(200);
  });

  it('LEITOR recebe 403 ao criar agente', async () => {
    const res = await request(await app())
      .post('/api/agentes')
      .set(bearer(tokenLeitor))
      .send({ nome: 'Não deveria', tipo: 'LLM' });
    expect(res.status).toBe(403);
    expect(res.body.erro).toBeTruthy();
  });

  it('LEITOR recebe 403 ao criar dataset', async () => {
    const res = await request(await app())
      .post('/api/datasets')
      .set(bearer(tokenLeitor))
      .send({ nome: 'Não deveria', tipo: 'TABELA', csv: 'rotulo,x\nA,1\n' });
    expect(res.status).toBe(403);
  });

  it('LEITOR recebe 403 ao criar usuário (só ADMIN gerencia usuários)', async () => {
    const res = await request(await app())
      .post('/api/usuarios')
      .set(bearer(tokenLeitor))
      .send({ nome: 'Outro', email: 'outro@aicreator.local', senha: SENHA_TESTE, perfil: 'DEV' });
    expect(res.status).toBe(403);
  });
});

describe('troca de senha', () => {
  const emailDev = 'dev-troca@aicreator.local';
  const senhaInicial = 'senha-inicial-1';
  const senhaNova = 'senha-nova-456';

  beforeAll(async () => {
    await criarUsuarioNoBanco('DEV', emailDev, senhaInicial);
  });

  it('login informa trocarSenha como booleano', async () => {
    const res = await request(await app())
      .post('/api/auth/login')
      .send({ email: emailDev, senha: senhaInicial });
    expect(res.status).toBe(200);
    expect(typeof res.body.usuario.trocarSenha).toBe('boolean');
  });

  it('recusa nova senha curta (mínimo 8 caracteres)', async () => {
    const token = await entrar(emailDev, senhaInicial);
    const res = await request(await app())
      .post('/api/auth/trocar-senha')
      .set(bearer(token))
      .send({ senhaAtual: senhaInicial, novaSenha: 'curta' });
    expect(res.status).toBe(400);
  });

  it('recusa senha atual errada', async () => {
    const token = await entrar(emailDev, senhaInicial);
    const res = await request(await app())
      .post('/api/auth/trocar-senha')
      .set(bearer(token))
      .send({ senhaAtual: 'nao-e-essa', novaSenha: senhaNova });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('troca a senha e devolve novo token com trocarSenha false', async () => {
    const token = await entrar(emailDev, senhaInicial);
    const res = await request(await app())
      .post('/api/auth/trocar-senha')
      .set(bearer(token))
      .send({ senhaAtual: senhaInicial, novaSenha: senhaNova });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.usuario).toMatchObject({ email: emailDev, trocarSenha: false });

    // A senha antiga deixa de valer e a nova entra.
    const antiga = await request(await app())
      .post('/api/auth/login')
      .send({ email: emailDev, senha: senhaInicial });
    expect(antiga.status).toBe(401);
    const nova = await request(await app())
      .post('/api/auth/login')
      .send({ email: emailDev, senha: senhaNova });
    expect(nova.status).toBe(200);
  });
});
