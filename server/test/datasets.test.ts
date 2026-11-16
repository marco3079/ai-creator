import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CSV_TABELA_VALIDO, app, bearer, criarDatasetTabela, prepararAdmin } from './ajuda';

let token = '';

beforeAll(async () => {
  token = await prepararAdmin();
});

describe('datasets CSV', () => {
  it('cria um dataset TABELA com classes e número de amostras', async () => {
    const res = await request(await app())
      .post('/api/datasets')
      .set(bearer(token))
      .send({ nome: 'Tabela válida', tipo: 'TABELA', csv: CSV_TABELA_VALIDO });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nome: 'Tabela válida', tipo: 'TABELA', amostras: 4 });
    expect(res.body.classes).toEqual(['A', 'B']);
  });

  it('amostra de TABELA traz cabeçalho e linhas', async () => {
    const dataset = await criarDatasetTabela(token, 'Para amostra');

    const res = await request(await app())
      .get(`/api/datasets/${dataset.id}/amostra`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.formato).toBe('TABELA');
    expect(res.body.cabecalho).toEqual(['rotulo', 'x', 'y']);
    expect(res.body.linhas).toHaveLength(4);
    expect(res.body.linhas[0]).toEqual(['A', '1', '2']);
  });

  it('CSV com valor não numérico vira 400 citando o número da linha', async () => {
    const csv = 'rotulo,x\nA,1\nB,abc\n';
    const res = await request(await app())
      .post('/api/datasets')
      .set(bearer(token))
      .send({ nome: 'Valor inválido', tipo: 'TABELA', csv });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/Linha 3/);
    expect(res.body.erro).toMatch(/x/);
  });

  it('CSV com coluna faltando vira 400 citando a linha', async () => {
    const csv = 'rotulo,x,y\nA,1,2\nB,3\n';
    const res = await request(await app())
      .post('/api/datasets')
      .set(bearer(token))
      .send({ nome: 'Colunas faltando', tipo: 'TABELA', csv });

    expect(res.status).toBe(400);
    expect(res.body.erro).toBe('Linha 3: esperadas 3 colunas, encontradas 2');
  });

  it('CSV sem a coluna rotulo no cabeçalho vira 400', async () => {
    const res = await request(await app())
      .post('/api/datasets')
      .set(bearer(token))
      .send({ nome: 'Sem rótulo', tipo: 'TABELA', csv: 'classe,x\nA,1\n' });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/rotulo/);
  });

  it('não grava dataset quando o CSV é inválido', async () => {
    const antes = await request(await app()).get('/api/datasets').set(bearer(token));
    await request(await app())
      .post('/api/datasets')
      .set(bearer(token))
      .send({ nome: 'Nunca gravado', tipo: 'TABELA', csv: 'rotulo,x\nA,nope\n' });
    const depois = await request(await app()).get('/api/datasets').set(bearer(token));

    expect(depois.body).toHaveLength(antes.body.length);
  });
});
