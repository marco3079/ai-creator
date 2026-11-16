import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { ErroHttp, idParam, rota } from '../../lib/erros';
import { autenticar } from '../../lib/auth';
import { iniciarMqtt } from './mqtt';
import dispositivoRouter from './dispositivo';
import { chaveConfere } from './comum';
import { montarAicConfigH } from './config';

// Módulo da frota: MQTT, HTTP do dispositivo (/ota/*) e o aic_config.h para o usuário.
iniciarMqtt();

const router = Router();

router.use(dispositivoRouter);

// aic_config.h do dispositivo. Exige ?chave=<chave> (confere com o hash guardado).
router.get(
  '/dispositivos/:id/config.h',
  autenticar,
  rota(async (req, res) => {
    const id = idParam(req);
    const bruto = req.query.chave;
    const chave = typeof bruto === 'string' ? bruto : '';
    if (!chave) {
      throw new ErroHttp(400, 'Informe a chave do dispositivo');
    }
    const dispositivo = await prisma.dispositivo.findUnique({ where: { id } });
    if (!dispositivo) {
      throw new ErroHttp(404, 'Dispositivo não encontrado');
    }
    if (!dispositivo.chaveHash) {
      throw new ErroHttp(400, 'Gere a chave do dispositivo antes de baixar o aic_config.h');
    }
    if (!chaveConfere(chave, dispositivo.chaveHash)) {
      throw new ErroHttp(403, 'Chave inválida');
    }
    const conteudo = montarAicConfigH({
      dispositivoId: dispositivo.id,
      chave,
      protocolo: req.protocol,
      host: req.get('host') ?? 'localhost',
      hostname: req.hostname,
    });
    res.setHeader('Content-Disposition', 'attachment; filename="aic_config.h"');
    res.type('text/plain; charset=utf-8').send(conteudo);
  })
);

export default router;
