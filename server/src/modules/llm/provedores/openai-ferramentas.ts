// OpenAI com ferramentas da plataforma: Chat Completions sem stream nas rodadas com ferramentas.
// Laço: enquanto a resposta pedir tool_calls, executa cada uma e devolve role:'tool'; o texto final vai por aoTexto.
import { config as configServidor } from '../../../lib/config';
import type { ExecutorComFerramentas, ResultadoFerramenta } from './ferramentas-tipos';
import { MAX_RODADAS_FERRAMENTAS, resumir } from './ferramentas-tipos';
import { MODELOS_OPENAI } from './openai';

const URL_CHAT = 'https://api.openai.com/v1/chat/completions';

type Papel = 'system' | 'user' | 'assistant' | 'tool';

interface ChamadaOpenai {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MensagemOpenai {
  role: Papel;
  content?: string | null;
  tool_calls?: ChamadaOpenai[];
  tool_call_id?: string;
}

interface RespostaOpenai {
  choices?: { message?: MensagemOpenai; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

function mensagemDeErro(texto: string, status: number): string {
  try {
    const dados = JSON.parse(texto) as { error?: { message?: string } };
    return `Erro da OpenAI (${status}): ${dados.error?.message ?? texto}`;
  } catch {
    return `Erro da OpenAI (${status}): ${texto || 'sem detalhes'}`;
  }
}

export const executarOpenaiComFerramentas: ExecutorComFerramentas = async (
  config,
  mensagens,
  ferramentas,
  executar,
  aoTexto,
  aoEvento,
  sinal,
) => {
  const chave = configServidor.openaiChave;
  if (!chave) throw new Error('OPENAI_API_KEY não configurada no servidor (.env).');

  const tools = ferramentas.map((f) => ({
    type: 'function' as const,
    function: { name: f.nome, description: f.descricao, parameters: f.esquema },
  }));
  const porNome = new Map(ferramentas.map((f) => [f.nome, f]));

  const historico: MensagemOpenai[] = config.promptSistema
    ? [{ role: 'system', content: config.promptSistema }, ...mensagens]
    : [...mensagens];

  const modelo = config.modelo || MODELOS_OPENAI[0];
  const uso = { entrada: 0, saida: 0, ferramentas: 0 };

  for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTAS; rodada++) {
    const corpo = {
      model: modelo,
      messages: historico,
      tools,
      ...(config.temperatura != null ? { temperature: config.temperatura } : {}),
      ...(config.maxTokens ? { max_completion_tokens: config.maxTokens } : {}),
    };

    const resposta = await fetch(URL_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo),
      signal: sinal,
    });
    const texto = await resposta.text();
    if (!resposta.ok) throw new Error(mensagemDeErro(texto, resposta.status));

    const dados = JSON.parse(texto) as RespostaOpenai;
    if (dados.error) throw new Error(`Erro da OpenAI: ${dados.error.message ?? 'falha desconhecida'}`);

    uso.entrada += dados.usage?.prompt_tokens ?? 0;
    uso.saida += dados.usage?.completion_tokens ?? 0;

    const mensagem = dados.choices?.[0]?.message;
    if (!mensagem) throw new Error('A OpenAI não devolveu resposta.');

    const pedidos = mensagem.tool_calls ?? [];
    if (pedidos.length === 0) {
      const conteudo = mensagem.content ?? '';
      if (conteudo) aoTexto(conteudo);
      return uso;
    }

    historico.push({ role: 'assistant', content: mensagem.content ?? null, tool_calls: pedidos });

    for (const pedido of pedidos) {
      if (sinal.aborted) throw new Error('Execução cancelada.');
      const nome = pedido.function.name;
      const entradaTexto = pedido.function.arguments || '{}';
      aoEvento({ tipo: 'ferramenta', id: pedido.id, nome, entrada: resumir(entradaTexto), fase: 'inicio' });

      let resultado: ResultadoFerramenta;
      const definicao = porNome.get(nome);
      let entradaJson: unknown;
      try {
        entradaJson = JSON.parse(entradaTexto);
      } catch {
        entradaJson = undefined;
      }
      if (!definicao) {
        resultado = { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
      } else if (entradaJson === undefined) {
        resultado = { conteudo: 'Entrada inválida: JSON malformado', erro: true };
      } else {
        const valido = definicao.validar.safeParse(entradaJson);
        if (!valido.success) {
          resultado = { conteudo: `Entrada inválida: ${valido.error.issues[0]?.message ?? 'formato incorreto'}`, erro: true };
        } else {
          try {
            resultado = await executar(nome, valido.data);
          } catch (e) {
            resultado = { conteudo: e instanceof Error ? e.message : 'Erro ao executar a ferramenta.', erro: true };
          }
        }
      }

      uso.ferramentas += 1;
      aoEvento({
        tipo: 'ferramenta',
        id: pedido.id,
        nome,
        resultado: resumir(resultado.conteudo),
        erro: Boolean(resultado.erro),
        fase: 'fim',
      });
      historico.push({
        role: 'tool',
        tool_call_id: pedido.id,
        content: resultado.conteudo.slice(0, 20000),
      });
    }
  }

  throw new Error(`O agente passou de ${MAX_RODADAS_FERRAMENTAS} rodadas de ferramentas sem terminar.`);
};
