import { Router } from 'express';
import { rota } from '../../lib/erros';
import { autenticar } from '../../lib/auth';
import { ouvirEventos } from '../../lib/eventos';
import { iniciarFila, situacaoFila } from './despachante';
import { iniciarVigia } from './vigia';
import { NOMES_SERVICOS, capacidadeDe, servicoOnline } from './servicos';

const router = Router();

// Liga o despachante e a vigia ao subir o server (idempotentes; desligados com FILA_DESLIGADA=1).
iniciarFila();
iniciarVigia();

// Situação da fila por serviço: capacidade, quantos executam, quantos esperam e se estão online.
router.get(
  '/fila',
  autenticar,
  rota(async (_req, res) => {
    const situacao = await situacaoFila();
    const servicos = await Promise.all(
      NOMES_SERVICOS.map(async (nome) => ({
        nome,
        capacidade: capacidadeDe(nome),
        executando: situacao[nome].executando,
        naFila: situacao[nome].naFila,
        online: await servicoOnline(nome),
      })),
    );
    res.json({ servicos });
  }),
);

// Eventos ao vivo dos trabalhos (SSE). Cada evento é um EventoTrabalho em JSON.
router.get(
  '/eventos',
  autenticar,
  rota(async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const escrever = (texto: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(texto);
    };
    const parar = ouvirEventos((evento) => escrever(`data: ${JSON.stringify(evento)}\n\n`));
    // Ping para o proxy não fechar a conexão parada.
    const ping = setInterval(() => escrever(': ping\n\n'), 25_000);

    res.on('close', () => {
      clearInterval(ping);
      parar();
    });
  }),
);

export default router;
