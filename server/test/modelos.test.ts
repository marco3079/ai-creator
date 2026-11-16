import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, criarDatasetTabela, prepararAdmin } from './ajuda';

let token = '';
let datasetId = 0;

beforeAll(async () => {
  token = await prepararAdmin();
  datasetId = (await criarDatasetTabela(token, 'Dataset para modelos')).id;
});

async function criarModeloTabular(nome: string) {
  const res = await request(await app())
    .post('/api/modelos')
    .set(bearer(token))
    .send({ nome, tipo: 'TABULAR', tarefa: 'CLASSIFICACAO', datasetId });
  expect(res.status).toBe(201);
  return res.body as { id: number; nome: string; tipo: string };
}

describe('modelos', () => {
  it('cria um modelo TABULAR ligado a um dataset de tabela', async () => {
    const modelo = await criarModeloTabular('Classificador tabular');

    expect(modelo).toMatchObject({ nome: 'Classificador tabular', tipo: 'TABULAR' });
  });

  it('recusa modelo TABULAR com tarefa de imagens (400)', async () => {
    const res = await request(await app())
      .post('/api/modelos')
      .set(bearer(token))
      .send({ nome: 'Tarefa errada', tipo: 'TABULAR', tarefa: 'IMAGEM', datasetId });
    expect(res.status).toBe(400);
  });

  it('GET /modelos/opcoes devolve as opções de arquitetura e algoritmo', async () => {
    const res = await request(await app()).get('/api/modelos/opcoes').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.tinyml.arquiteturas.length).toBeGreaterThan(0);
    expect(res.body.tabular.algoritmos.length).toBeGreaterThan(0);
    expect(res.body.tabular.algoritmos[0]).toHaveProperty('hiperparametros');
  });

  it('treinar cria um TreinoModelo em FILA (despachante desligado por FILA_DESLIGADA=1)', async () => {
    const modelo = await criarModeloTabular('Modelo para treinar');

    const res = await request(await app())
      .post(`/api/modelos/${modelo.id}/treinar`)
      .set(bearer(token))
      .send({});

    expect([201, 202]).toContain(res.status);
    expect(res.body.status).toBe('FILA');

    // Como o despachante está desligado, o treino continua na fila.
    const depois = await request(await app())
      .get(`/api/treinos-modelo/${res.body.id}`)
      .set(bearer(token));
    expect(depois.status).toBe(200);
    expect(depois.body.status).toBe('FILA');
  });

  it('treinar sem dataset (nem no pedido nem no modelo) vira 400', async () => {
    const semDataset = await request(await app())
      .post('/api/modelos')
      .set(bearer(token))
      .send({ nome: 'Sem dataset', tipo: 'TABULAR', tarefa: 'CLASSIFICACAO' });
    expect(semDataset.status).toBe(201);

    const res = await request(await app())
      .post(`/api/modelos/${semDataset.body.id}/treinar`)
      .set(bearer(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.erro).toBe('Escolha um dataset');
  });
});
