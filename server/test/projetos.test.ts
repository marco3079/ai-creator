import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, prepararAdmin } from './ajuda';

let token = '';

beforeAll(async () => {
  token = await prepararAdmin();
});

async function lerArquivo(projetoId: number, caminho: string): Promise<string> {
  const res = await request(await app())
    .get(`/api/projetos/${projetoId}/arquivo`)
    .query({ caminho })
    .set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.conteudo as string;
}

describe('projetos', () => {
  it('cria projeto com os arquivos-modelo da placa (src/main.cpp e platformio.ini)', async () => {
    const res = await request(await app())
      .post('/api/projetos')
      .set(bearer(token))
      .send({ nome: 'Projeto Blink', placa: 'ESP32' });

    expect(res.status).toBe(201);
    const caminhos = res.body.arquivos.map((a: { caminho: string }) => a.caminho);
    expect(caminhos).toContain('src/main.cpp');
    expect(caminhos).toContain('platformio.ini');

    const ini = await lerArquivo(res.body.id, 'platformio.ini');
    expect(ini).toContain('[env:principal]');
    expect(ini).toContain('platform = espressif32');
  });

  it('projeto com modelo COLETOR gera src/main.cpp com a marcação AIC-COLETA', async () => {
    const res = await request(await app())
      .post('/api/projetos')
      .set(bearer(token))
      .send({ nome: 'Projeto Coletor', placa: 'ESP32', modelo: 'COLETOR' });

    expect(res.status).toBe(201);
    const main = await lerArquivo(res.body.id, 'src/main.cpp');
    expect(main).toContain('AIC-COLETA');
  });

  it('projeto sem modelo informado não traz a marcação de coleta', async () => {
    const res = await request(await app())
      .post('/api/projetos')
      .set(bearer(token))
      .send({ nome: 'Projeto Sem Coleta', placa: 'ESP32' });

    expect(res.status).toBe(201);
    const main = await lerArquivo(res.body.id, 'src/main.cpp');
    expect(main).not.toContain('AIC-COLETA');
  });

  it('build com modeloTreinoId inexistente responde 400', async () => {
    const projeto = await request(await app())
      .post('/api/projetos')
      .set(bearer(token))
      .send({ nome: 'Projeto Build', placa: 'ESP32' });
    expect(projeto.status).toBe(201);

    const res = await request(await app())
      .post(`/api/projetos/${projeto.body.id}/build`)
      .set(bearer(token))
      .send({ modeloTreinoId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body.erro).toBeTruthy();
  });

  it('recusa caminho de arquivo com ".." (400)', async () => {
    const projeto = await request(await app())
      .post('/api/projetos')
      .set(bearer(token))
      .send({ nome: 'Projeto Caminho', placa: 'ESP32' });

    const res = await request(await app())
      .put(`/api/projetos/${projeto.body.id}/arquivo`)
      .set(bearer(token))
      .send({ caminho: '../fora.txt', conteudo: 'x' });

    expect(res.status).toBe(400);
  });
});
