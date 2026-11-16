import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EMAIL_ADMIN, SENHA_TESTE, app, bearer, criarUsuarioNoBanco, entrar, prepararAdmin } from './ajuda';

let tokenAdmin = '';

beforeAll(async () => {
  tokenAdmin = await prepararAdmin();
});

describe('tokens de API (aic_)', () => {
  it('cria token com prefixo aic_ e devolve o valor em claro só nesta resposta', async () => {
    const res = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Integração VS Code' });

    expect(res.status).toBe(201);
    expect(res.body.token.startsWith('aic_')).toBe(true);
    expect(res.body.registro).toMatchObject({ nome: 'Integração VS Code', revogado: false });
    expect(res.body.registro).not.toHaveProperty('hash');

    const lista = await request(await app()).get('/api/tokens').set(bearer(tokenAdmin));
    expect(lista.status).toBe(200);
    expect(lista.body[0]).not.toHaveProperty('hash');
    expect(JSON.stringify(lista.body)).not.toContain(res.body.token);
  });

  it('token aic_ autentica nas rotas protegidas', async () => {
    const criado = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Para autenticar' });

    const res = await request(await app())
      .get('/api/auth/eu')
      .set(bearer(criado.body.token));

    expect(res.status).toBe(200);
    expect(res.body.usuario.email).toBe(EMAIL_ADMIN);
  });

  it('registra último uso do token ao autenticar', async () => {
    const criado = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Último uso' });
    expect(criado.body.registro.ultimoUso).toBeNull();

    await request(await app()).get('/api/agentes').set(bearer(criado.body.token));

    const lista = await request(await app()).get('/api/tokens').set(bearer(tokenAdmin));
    const registro = lista.body.find((t: { id: number }) => t.id === criado.body.registro.id);
    expect(registro.ultimoUso).not.toBeNull();
  });

  it('revogar o token impede novas chamadas', async () => {
    const criado = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: 'Para revogar' });

    const revogado = await request(await app())
      .delete(`/api/tokens/${criado.body.registro.id}`)
      .set(bearer(tokenAdmin));
    expect(revogado.status).toBe(204);

    const res = await request(await app()).get('/api/agentes').set(bearer(criado.body.token));
    expect(res.status).toBe(401);
  });

  it('não permite revogar token de outro usuário (404)', async () => {
    const outro = await criarUsuarioNoBanco('DEV', 'dev-tokens@aicreator.local');
    const tokenOutro = await entrar(outro.email, SENHA_TESTE);
    const doOutro = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenOutro))
      .send({ nome: 'Do outro' });

    const res = await request(await app())
      .delete(`/api/tokens/${doOutro.body.registro.id}`)
      .set(bearer(tokenAdmin));

    expect(res.status).toBe(404);
  });

  it('LEITOR não cria token (403)', async () => {
    await criarUsuarioNoBanco('LEITOR', 'leitor-tokens@aicreator.local');
    const tokenLeitor = await entrar('leitor-tokens@aicreator.local', SENHA_TESTE);

    const res = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenLeitor))
      .send({ nome: 'Não deveria' });

    expect(res.status).toBe(403);
  });

  it('nome de token vazio vira 400', async () => {
    const res = await request(await app())
      .post('/api/tokens')
      .set(bearer(tokenAdmin))
      .send({ nome: '' });
    expect(res.status).toBe(400);
  });
});
