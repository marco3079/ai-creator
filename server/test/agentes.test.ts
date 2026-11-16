import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, prepararAdmin } from './ajuda';

let token = '';

beforeAll(async () => {
  token = await prepararAdmin();
});

async function criarAgente(nome: string) {
  const res = await request(await app())
    .post('/api/agentes')
    .set(bearer(token))
    .send({
      nome,
      tipo: 'LLM',
      descricao: 'Agente criado pelo teste',
      provedor: 'ANTHROPIC',
      promptSistema: 'Responda em português.',
      tags: ['teste'],
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; slug: string; versao: number; nome: string };
}

describe('agentes', () => {
  it('cria um agente LLM com slug e versão 1', async () => {
    const agente = await criarAgente('Agente Criação');

    expect(agente.slug).toBe('agente-criacao');
    expect(agente.versao).toBe(1);
    expect(agente.nome).toBe('Agente Criação');
  });

  it('aparece na lista e aceita busca pelo nome', async () => {
    await criarAgente('Agente Listado');

    const todos = await request(await app()).get('/api/agentes').set(bearer(token));
    expect(todos.status).toBe(200);
    expect(todos.body.map((a: { nome: string }) => a.nome)).toContain('Agente Listado');

    const busca = await request(await app())
      .get('/api/agentes?busca=listado')
      .set(bearer(token));
    expect(busca.body).toHaveLength(1);
    expect(busca.body[0].nome).toBe('Agente Listado');
  });

  it('rejeita criação sem nome com 400', async () => {
    const res = await request(await app())
      .post('/api/agentes')
      .set(bearer(token))
      .send({ nome: '   ', tipo: 'LLM' });
    expect(res.status).toBe(400);
    expect(res.body.erro).toBeTruthy();
  });

  it('PUT gera a versão 2 e registra o histórico', async () => {
    const agente = await criarAgente('Agente Versionado');

    const res = await request(await app())
      .put(`/api/agentes/${agente.id}`)
      .set(bearer(token))
      .send({ promptSistema: 'Novo prompt.', nota: 'Ajuste de tom' });

    expect(res.status).toBe(200);
    expect(res.body.versao).toBe(2);
    expect(res.body.promptSistema).toBe('Novo prompt.');

    const versoes = await request(await app())
      .get(`/api/agentes/${agente.id}/versoes`)
      .set(bearer(token));
    expect(versoes.status).toBe(200);
    expect(versoes.body.map((v: { versao: number }) => v.versao)).toEqual([2, 1]);
    expect(versoes.body[0].nota).toBe('Ajuste de tom');
  });

  it('exporta em Markdown (arquivo .md) e em JSON', async () => {
    const agente = await criarAgente('Agente Exportado');

    const md = await request(await app())
      .get(`/api/agentes/${agente.id}/exportar?formato=md`)
      .set(bearer(token));
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.headers['content-disposition']).toContain('agente-exportado.md');
    expect(md.text).toContain('name: agente-exportado');
    expect(md.text).toContain('Responda em português.');

    const json = await request(await app())
      .get(`/api/agentes/${agente.id}/exportar?formato=json`)
      .set(bearer(token));
    expect(json.status).toBe(200);
    expect(json.body).toMatchObject({ nome: 'Agente Exportado', tipo: 'LLM' });
    expect(json.body).not.toHaveProperty('id');
  });

  it('recusa exportar formato desconhecido com 400', async () => {
    const agente = await criarAgente('Agente Formato');
    const res = await request(await app())
      .get(`/api/agentes/${agente.id}/exportar?formato=pdf`)
      .set(bearer(token));
    expect(res.status).toBe(400);
  });

  it('importa um .md exportado depois de apagar o agente', async () => {
    const original = await criarAgente('Agente Ida e Volta');
    const exportado = await request(await app())
      .get(`/api/agentes/${original.id}/exportar?formato=md`)
      .set(bearer(token));
    expect(exportado.status).toBe(200);

    const apagado = await request(await app())
      .delete(`/api/agentes/${original.id}`)
      .set(bearer(token));
    expect(apagado.status).toBe(204);

    const importado = await request(await app())
      .post('/api/agentes/importar')
      .set(bearer(token))
      .send({ conteudo: exportado.text, formato: 'md' });
    expect(importado.status).toBe(201);
    // O .md usa o slug como name, então o nome volta em minúsculas; conferimos slug, tipo e prompt.
    expect(importado.body).toMatchObject({ tipo: 'LLM', slug: 'agente-ida-e-volta', promptSistema: 'Responda em português.' });
  });

  it('importa JSON e atualiza o agente se o slug já existir', async () => {
    const novo = await request(await app())
      .post('/api/agentes/importar')
      .set(bearer(token))
      .send({
        conteudo: JSON.stringify({ nome: 'Agente Importado JSON', tipo: 'LLM', promptSistema: 'v1' }),
        formato: 'json',
      });
    expect(novo.status).toBe(201);

    const atualizado = await request(await app())
      .post('/api/agentes/importar')
      .set(bearer(token))
      .send({
        conteudo: JSON.stringify({ nome: 'Agente Importado JSON', tipo: 'LLM', promptSistema: 'v2' }),
        formato: 'json',
      });
    expect(atualizado.status).toBe(200);
    expect(atualizado.body.id).toBe(novo.body.id);
    expect(atualizado.body.versao).toBe(2);
    expect(atualizado.body.promptSistema).toBe('v2');
  });

  it('rejeita JSON inválido na importação com 400', async () => {
    const res = await request(await app())
      .post('/api/agentes/importar')
      .set(bearer(token))
      .send({ conteudo: '{isto não é json', formato: 'json' });
    expect(res.status).toBe(400);
    expect(res.body.erro).toBeTruthy();
  });
});
