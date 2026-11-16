import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { rota } from '../../lib/erros';
import { autenticar, exigirPerfil } from '../../lib/auth';
import { registrar } from '../../lib/log';
import { config } from '../../lib/config';

// Atualização pelo GitHub (botão de atualizar no painel). Contrato em docs/plano/CONTRATO-ATUALIZADOR.md.
// Só o perfil ADMIN acessa. Conversa com o serviço "atualizador" pela rede interna.

const router = Router();

const MOTIVO_DESLIGADO = 'Defina JWT_SECRET no .env para usar a atualização';
const MOTIVO_INACESSIVEL =
  'O serviço de atualização não está respondendo. Rode o instalador de novo para criá-lo.';
const MOTIVO_RESPOSTA_INVALIDA = 'O serviço de atualização respondeu de forma inesperada.';
const MOTIVO_TOKEN = 'O serviço de atualização recusou a conexão. Rode o instalador de novo na pasta do projeto.';
const ERRO_EM_ANDAMENTO = 'Já existe uma atualização em andamento';

// Abaixo dos 60 s do nginx e acima dos 45 s que o atualizador dá ao `git fetch`.
const TIMEOUT_VERIFICAR_MS = 55_000;
const TIMEOUT_CONSULTA_MS = 20_000;
const TIMEOUT_INICIAR_MS = 20_000;

// Tempo de vida do resumo em memória (aviso do topo).
const CACHE_RESUMO_MS = 60_000;

const commitSchema = z.object({
  commit: z.string(),
  curto: z.string(),
  data: z.string(),
  mensagem: z.string(),
});

const estadoSchema = z.object({
  ramo: z.string().nullable(),
  repositorio: z.string().nullable(),
  instalado: commitSchema.nullable(),
  implantado: z.string().nullable(),
  remoto: commitSchema.nullable(),
  atras: z.number().int().nonnegative(),
  novidades: z.array(
    z.object({
      curto: z.string(),
      mensagem: z.string(),
      data: z.string(),
    })
  ),
  precisaReconstruir: z.boolean(),
  atualizadorMudou: z.boolean(),
  verificadoEm: z.string().nullable(),
  erroVerificacao: z.string().nullable(),
  // true enquanto o atualizador busca as novidades em segundo plano
  verificando: z.boolean().optional(),
  servicos: z.array(z.string()),
  copias: z.array(
    z.object({
      nome: z.string(),
      tamanhoBytes: z.number(),
      criadoEm: z.string(),
    })
  ),
  tarefa: z.object({
    estado: z.enum(['PARADA', 'EXECUTANDO', 'CONCLUIDA', 'FALHOU']),
    etapa: z.string(),
    iniciadaEm: z.string().nullable(),
    terminadaEm: z.string().nullable(),
    erro: z.string().nullable(),
    log: z.array(z.string()),
  }),
});

type EstadoAtualizacao = z.infer<typeof estadoSchema>;

export type AtualizacaoDTO =
  | { disponivel: false; motivo: string }
  | ({ disponivel: true } & EstadoAtualizacao);

export interface ResumoAtualizacao {
  disponivel: boolean;
  atras: number;
  remoto: string | null;
}

// ---------- Funções auxiliares ----------

// Token do atualizador: SHA-256('atualizador:' + segredo efetivo) em hexadecimal.
function tokenDoAtualizador(): string | null {
  const segredo = (config.jwtSegredo ?? '').trim();
  if (segredo === '') return null;
  return crypto.createHash('sha256').update('atualizador:' + segredo).digest('hex');
}

function enderecoDoAtualizador(): string {
  const valor = (process.env.ATUALIZADOR_URL ?? '').trim();
  return (valor === '' ? 'http://atualizador:4000' : valor).replace(/\/+$/, '');
}

// Tira credenciais de endereços (usuario:senha@) e troca o endereço interno do serviço por um rótulo.
function limparTexto(texto: string): string {
  let limpo = texto.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/gi, '$1');
  const base = enderecoDoAtualizador();
  let host = '';
  try {
    host = new URL(base).host;
  } catch {
    host = '';
  }
  limpo = limpo.split(base).join('o serviço de atualização');
  if (host !== '') {
    limpo = limpo.split(host).join('o serviço de atualização');
  }
  return limpo;
}

function limparEstado(estado: EstadoAtualizacao): EstadoAtualizacao {
  return {
    ...estado,
    repositorio: estado.repositorio === null ? null : limparTexto(estado.repositorio),
    erroVerificacao: estado.erroVerificacao === null ? null : limparTexto(estado.erroVerificacao),
    tarefa: {
      ...estado.tarefa,
      erro: estado.tarefa.erro === null ? null : limparTexto(estado.tarefa.erro),
      log: estado.tarefa.log.map(limparTexto),
    },
  };
}

function indisponivel(motivo: string): AtualizacaoDTO {
  return { disponivel: false, motivo };
}

// Chamada ao atualizador. Devolve a resposta ou null se não houver conexão ou tempo esgotado.
async function chamarAtualizador(
  caminho: string,
  metodo: 'GET' | 'POST',
  token: string,
  tempoLimiteMs: number
): Promise<Response | null> {
  try {
    return await fetch(enderecoDoAtualizador() + caminho, {
      method: metodo,
      headers: { 'X-Atualizador-Token': token },
      signal: AbortSignal.timeout(tempoLimiteMs),
    });
  } catch {
    return null;
  }
}

async function consultarEstado(verificar: boolean): Promise<AtualizacaoDTO> {
  const token = tokenDoAtualizador();
  if (token === null) return indisponivel(MOTIVO_DESLIGADO);

  const resposta = await chamarAtualizador(
    verificar ? '/estado?verificar=1' : '/estado',
    'GET',
    token,
    verificar ? TIMEOUT_VERIFICAR_MS : TIMEOUT_CONSULTA_MS
  );
  if (resposta === null) return indisponivel(MOTIVO_INACESSIVEL);
  if (resposta.status === 401) return indisponivel(MOTIVO_TOKEN);
  if (resposta.status !== 200) return indisponivel(MOTIVO_INACESSIVEL);

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return indisponivel(MOTIVO_RESPOSTA_INVALIDA);
  }
  const validado = estadoSchema.safeParse(corpo);
  if (!validado.success) return indisponivel(MOTIVO_RESPOSTA_INVALIDA);

  return { disponivel: true, ...limparEstado(validado.data) };
}

// Cache do resumo em memória (60 s). Guarda também o resultado de falha.
let cacheResumo: { quando: number; resumo: ResumoAtualizacao } | null = null;

async function calcularResumo(): Promise<ResumoAtualizacao> {
  const dto = await consultarEstado(false);
  if (!dto.disponivel) return { disponivel: false, atras: 0, remoto: null };
  return { disponivel: true, atras: dto.atras, remoto: dto.remoto === null ? null : dto.remoto.curto };
}

async function obterResumo(): Promise<ResumoAtualizacao> {
  const agora = Date.now();
  if (cacheResumo !== null && agora - cacheResumo.quando < CACHE_RESUMO_MS) {
    return cacheResumo.resumo;
  }
  const resumo = await calcularResumo();
  cacheResumo = { quando: Date.now(), resumo };
  return resumo;
}

// ---------- Rotas (ADMIN) ----------

router.get(
  '/atualizacao',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const verificar = req.query.verificar === '1';
    const dto = await consultarEstado(verificar);
    res.json(dto);
  })
);

// Leve, para o aviso do topo. Usa /estado sem verificar e cache de 60 s.
router.get(
  '/atualizacao/resumo',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const resumo = await obterResumo();
    res.json(resumo);
  })
);

router.post(
  '/atualizacao',
  autenticar,
  exigirPerfil('ADMIN'),
  rota(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = tokenDoAtualizador();
    if (token === null) {
      res.status(503).json({ erro: MOTIVO_DESLIGADO });
      return;
    }

    const resposta = await chamarAtualizador('/atualizar', 'POST', token, TIMEOUT_INICIAR_MS);
    if (resposta === null) {
      res.status(503).json({ erro: MOTIVO_INACESSIVEL });
      return;
    }

    if (resposta.status === 202) {
      await registrar(req.usuario?.id ?? null, 'atualizacao.iniciar', 'Iniciou a atualização do sistema pelo painel');
      res.status(202).json({ iniciada: true });
      return;
    }

    if (resposta.status === 409) {
      let erro = ERRO_EM_ANDAMENTO;
      try {
        const corpo = z.object({ erro: z.string() }).safeParse(await resposta.json());
        if (corpo.success) erro = limparTexto(corpo.data.erro);
      } catch {
        erro = ERRO_EM_ANDAMENTO;
      }
      res.status(409).json({ erro });
      return;
    }

    res.status(503).json({ erro: MOTIVO_INACESSIVEL });
  })
);

export default router;
