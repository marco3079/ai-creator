import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { app, bearer, criarUsuarioNoBanco, entrar, prepararAdmin, SENHA_TESTE } from './ajuda';
import { config } from '../src/lib/config';
import { prisma } from '../src/lib/prisma';

// Atualizador falso: um servidor HTTP local que responde /estado e /atualizar conforme `modo`.
interface Chamada {
  metodo: string;
  caminho: string;
  token: string;
}

const chamadas: Chamada[] = [];
const modo: {
  estado: { status: number; corpo: string };
  atualizar: { status: number; corpo: string };
} = {
  estado: { status: 200, corpo: '' },
  atualizar: { status: 202, corpo: '{"iniciada":true}' },
};

let servidorFalso: http.Server;
let enderecoFalso = '';
let tokenAdmin = '';
let tokenLeitor = '';
let tokenDev = '';

const commitAtual = {
  commit: 'a'.repeat(40),
  curto: 'aaaaaaa',
  data: '2026-11-01T10:00:00Z',
  mensagem: 'feat: versão instalada',
};

const commitRemoto = {
  commit: 'b'.repeat(40),
  curto: 'bbbbbbb',
  data: '2026-11-10T10:00:00Z',
  mensagem: 'feat: versão nova',
};

function estadoValido(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ramo: 'main',
    repositorio: 'https://github.com/exemplo/ai-creator',
    instalado: commitAtual,
    implantado: commitAtual.commit,
    remoto: commitRemoto,
    atras: 2,
    novidades: [{ curto: 'bbbbbbb', mensagem: 'feat: versão nova', data: '2026-11-10T10:00:00Z' }],
    precisaReconstruir: true,
    atualizadorMudou: false,
    verificadoEm: '2026-11-16T12:00:00Z',
    erroVerificacao: null,
    servicos: ['server', 'client'],
    copias: [{ nome: 'aicreator-20261116-120000.sql', tamanhoBytes: 2048, criadoEm: '2026-11-16T12:00:00Z' }],
    tarefa: { estado: 'PARADA', etapa: '', iniciadaEm: null, terminadaEm: null, erro: null, log: [] },
    ...extra,
  };
}

function tokenEsperado(): string {
  return crypto.createHash('sha256').update('atualizador:' + config.jwtSegredo).digest('hex');
}

// Porta livre que não tem ninguém escutando (o servidor é fechado logo depois).
async function portaFechada(): Promise<string> {
  const temp = http.createServer();
  await new Promise<void>((ok) => temp.listen(0, '127.0.0.1', () => ok()));
  const porta = (temp.address() as AddressInfo).port;
  await new Promise<void>((ok) => temp.close(() => ok()));
  return `http://127.0.0.1:${porta}`;
}

async function comAtualizadorFora(fn: () => Promise<void>): Promise<void> {
  const anterior = process.env.ATUALIZADOR_URL;
  process.env.ATUALIZADOR_URL = await portaFechada();
  try {
    await fn();
  } finally {
    process.env.ATUALIZADOR_URL = anterior;
  }
}

beforeAll(async () => {
  servidorFalso = http.createServer((req, res) => {
    const caminho = req.url ?? '';
    chamadas.push({
      metodo: req.method ?? '',
      caminho,
      token: String(req.headers['x-atualizador-token'] ?? ''),
    });
    if (caminho.startsWith('/estado')) {
      res.writeHead(modo.estado.status, { 'Content-Type': 'application/json' });
      res.end(modo.estado.corpo);
      return;
    }
    if (caminho === '/atualizar') {
      res.writeHead(modo.atualizar.status, { 'Content-Type': 'application/json' });
      res.end(modo.atualizar.corpo);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((ok) => servidorFalso.listen(0, '127.0.0.1', () => ok()));
  enderecoFalso = `http://127.0.0.1:${(servidorFalso.address() as AddressInfo).port}`;
  process.env.ATUALIZADOR_URL = enderecoFalso;

  tokenAdmin = await prepararAdmin();
  await criarUsuarioNoBanco('LEITOR', 'leitor-atualizacao@aicreator.local');
  await criarUsuarioNoBanco('DEV', 'dev-atualizacao@aicreator.local');
  tokenLeitor = await entrar('leitor-atualizacao@aicreator.local', SENHA_TESTE);
  tokenDev = await entrar('dev-atualizacao@aicreator.local', SENHA_TESTE);
});

afterAll(async () => {
  delete process.env.ATUALIZADOR_URL;
  await new Promise<void>((ok) => servidorFalso.close(() => ok()));
});

beforeEach(() => {
  chamadas.length = 0;
  modo.estado = { status: 200, corpo: JSON.stringify(estadoValido()) };
  modo.atualizar = { status: 202, corpo: '{"iniciada":true}' };
  process.env.ATUALIZADOR_URL = enderecoFalso;
});

describe('atualizacao: permissão', () => {
  it('LEITOR e DEV recebem 403 e o atualizador não é chamado', async () => {
    for (const token of [tokenLeitor, tokenDev]) {
      const get = await request(await app()).get('/api/atualizacao').set(bearer(token));
      expect(get.status).toBe(403);
      const resumo = await request(await app()).get('/api/atualizacao/resumo').set(bearer(token));
      expect(resumo.status).toBe(403);
      const post = await request(await app()).post('/api/atualizacao').set(bearer(token));
      expect(post.status).toBe(403);
    }
    expect(chamadas).toHaveLength(0);
  });

  it('sem token recebe 401', async () => {
    const res = await request(await app()).get('/api/atualizacao');
    expect(res.status).toBe(401);
  });
});

describe('atualizacao: GET /atualizacao', () => {
  it('ADMIN recebe o estado validado, sem cache e com o token do atualizador', async () => {
    const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.disponivel).toBe(true);
    expect(res.body.atras).toBe(2);
    expect(res.body.servicos).toEqual(['server', 'client']);
    expect(res.body.copias).toEqual([
      { nome: 'aicreator-20261116-120000.sql', tamanhoBytes: 2048, criadoEm: '2026-11-16T12:00:00Z' },
    ]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].caminho).toBe('/estado');
    expect(chamadas[0].token).toBe(tokenEsperado());
  });

  it('?verificar=1 repassa a verificação ao atualizador', async () => {
    const res = await request(await app()).get('/api/atualizacao?verificar=1').set(bearer(tokenAdmin));
    expect(res.status).toBe(200);
    expect(chamadas[0].caminho).toBe('/estado?verificar=1');
  });

  it('resposta fora do formato vira disponivel:false', async () => {
    modo.estado = { status: 200, corpo: JSON.stringify({ ramo: 'main' }) };
    const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(false);
    expect(typeof res.body.motivo).toBe('string');
  });

  it('resposta que não é JSON vira disponivel:false', async () => {
    modo.estado = { status: 200, corpo: 'isto não é json' };
    const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.body.disponivel).toBe(false);
  });

  it('token recusado pelo atualizador (401) vira disponivel:false', async () => {
    modo.estado = { status: 401, corpo: '{"erro":"Não autenticado"}' };
    const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.body.disponivel).toBe(false);
    expect(res.body.motivo).toMatch(/recusou/);
  });

  it('atualizador fora fica disponivel:false com motivo', async () => {
    await comAtualizadorFora(async () => {
      const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ disponivel: false, motivo: expect.stringContaining('não está respondendo') });
    });
  });

  it('limpa credenciais de URL e o endereço interno do atualizador', async () => {
    modo.estado = {
      status: 200,
      corpo: JSON.stringify(
        estadoValido({
          repositorio: 'https://u:p@github.com/x',
          erroVerificacao: `falha ao falar com ${enderecoFalso}/estado`,
        })
      ),
    };
    const res = await request(await app()).get('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.body.disponivel).toBe(true);
    expect(res.body.repositorio).toBe('https://github.com/x');
    expect(res.body.erroVerificacao).not.toContain(enderecoFalso);
    expect(JSON.stringify(res.body)).not.toContain('u:p@');
  });
});

describe('atualizacao: POST /atualizacao', () => {
  it('202 é repassado e registrado no log', async () => {
    const antes = await prisma.log.count({ where: { acao: 'atualizacao.iniciar' } });
    const res = await request(await app()).post('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ iniciada: true });
    expect(res.headers['cache-control']).toBe('no-store');
    const ultima = chamadas[chamadas.length - 1];
    expect(ultima.metodo).toBe('POST');
    expect(ultima.caminho).toBe('/atualizar');
    expect(ultima.token).toBe(tokenEsperado());
    const depois = await prisma.log.count({ where: { acao: 'atualizacao.iniciar' } });
    expect(depois).toBe(antes + 1);
  });

  it('409 do atualizador é repassado com a mensagem', async () => {
    modo.atualizar = { status: 409, corpo: '{"erro":"Já existe uma tarefa EXECUTANDO"}' };
    const res = await request(await app()).post('/api/atualizacao').set(bearer(tokenAdmin));
    expect(res.status).toBe(409);
    expect(res.body.erro).toBe('Já existe uma tarefa EXECUTANDO');
  });

  it('atualizador fora gera 503', async () => {
    await comAtualizadorFora(async () => {
      const res = await request(await app()).post('/api/atualizacao').set(bearer(tokenAdmin));
      expect(res.status).toBe(503);
      expect(typeof res.body.erro).toBe('string');
    });
  });
});

describe('atualizacao: GET /atualizacao/resumo', () => {
  // Cada teste começa 10 min à frente do anterior, então o cache de teste anterior expira.
  // Partimos da hora real (não de uma data fixa) para o JWT da sessão de teste não expirar.
  let relogio = Date.now();

  function avancar(ms: number): void {
    relogio += ms;
    vi.setSystemTime(relogio);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    avancar(600_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve o resumo e usa cache de 60 s', async () => {
    const res1 = await request(await app()).get('/api/atualizacao/resumo').set(bearer(tokenAdmin));
    expect(res1.status).toBe(200);
    expect(res1.headers['cache-control']).toBe('no-store');
    expect(res1.body).toEqual({ disponivel: true, atras: 2, remoto: 'bbbbbbb' });
    expect(chamadas.filter((c) => c.caminho === '/estado')).toHaveLength(1);

    avancar(30_000);
    const res2 = await request(await app()).get('/api/atualizacao/resumo').set(bearer(tokenAdmin));
    expect(res2.body).toEqual({ disponivel: true, atras: 2, remoto: 'bbbbbbb' });
    expect(chamadas.filter((c) => c.caminho === '/estado')).toHaveLength(1);

    avancar(31_000);
    await request(await app()).get('/api/atualizacao/resumo').set(bearer(tokenAdmin));
    expect(chamadas.filter((c) => c.caminho === '/estado')).toHaveLength(2);
  });

  it('atualizador indisponível devolve {disponivel:false, atras:0, remoto:null}', async () => {
    await comAtualizadorFora(async () => {
      const res = await request(await app()).get('/api/atualizacao/resumo').set(bearer(tokenAdmin));
      expect(res.body).toEqual({ disponivel: false, atras: 0, remoto: null });
    });
  });

  it('resposta inválida devolve {disponivel:false, atras:0, remoto:null}', async () => {
    modo.estado = { status: 500, corpo: '' };
    const res = await request(await app()).get('/api/atualizacao/resumo').set(bearer(tokenAdmin));
    expect(res.body).toEqual({ disponivel: false, atras: 0, remoto: null });
  });
});
