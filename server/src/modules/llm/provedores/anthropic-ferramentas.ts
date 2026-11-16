import Anthropic from '@anthropic-ai/sdk';
import { ESFORCOS } from './anthropic';
import type { ExecutorComFerramentas, ResultadoFerramenta } from './ferramentas-tipos';
import { MAX_RODADAS_FERRAMENTAS, resumir } from './ferramentas-tipos';

let cliente: Anthropic | null = null;

function obterCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor (.env).');
  }
  cliente ??= new Anthropic();
  return cliente;
}

// Laço manual com streaming: o texto chega em tempo real e, quando o Claude pede ferramentas,
// elas são validadas e executadas aqui; o resultado volta ao modelo até ele terminar.
// Os blocos da resposta (inclusive os de thinking) são devolvidos sem alteração a cada rodada.
export const executarAnthropicComFerramentas: ExecutorComFerramentas = async (
  config,
  mensagens,
  ferramentas,
  executar,
  aoTexto,
  aoEvento,
  sinal,
) => {
  const anthropic = obterCliente();
  const esforco = ESFORCOS.includes(config.esforco as (typeof ESFORCOS)[number]) ? config.esforco : 'high';
  const modelo = config.modelo || 'claude-opus-5-5';

  const tools: Anthropic.Tool[] = ferramentas.map((f) => ({
    name: f.nome,
    description: f.descricao,
    input_schema: f.esquema as Anthropic.Tool.InputSchema,
    eager_input_streaming: true,
  }));
  const porNome = new Map(ferramentas.map((f) => [f.nome, f]));

  const historico: Anthropic.MessageParam[] = mensagens.map((m) => ({ role: m.role, content: m.content }));
  const uso = { entrada: 0, saida: 0, ferramentas: 0 };
  let falhasJson = 0;

  for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTAS; rodada++) {
    const fluxo = anthropic.messages.stream(
      {
        model: modelo,
        max_tokens: config.maxTokens && config.maxTokens > 0 ? config.maxTokens : 64000,
        system: config.promptSistema || undefined,
        thinking: { type: 'adaptive' },
        output_config: { effort: esforco },
        tools,
        messages: historico,
      } as never,
      { signal: sinal },
    );
    fluxo.on('text', (texto: string) => aoTexto(texto));

    let mensagem: Anthropic.Message;
    try {
      mensagem = await fluxo.finalMessage();
      falhasJson = 0;
    } catch (e) {
      // Com eager_input_streaming, uma entrada de ferramenta ilegível rejeita o finalMessage: tenta a rodada de novo.
      if (e instanceof Anthropic.APIError || sinal.aborted || falhasJson++ >= 2) throw traduzirErro(e, modelo);
      continue;
    }

    uso.entrada += mensagem.usage.input_tokens;
    uso.saida += mensagem.usage.output_tokens;

    if (mensagem.stop_reason === 'refusal') {
      throw new Error('O modelo recusou este pedido. Reformule a mensagem.');
    }
    if (mensagem.stop_reason === 'pause_turn') {
      historico.push({ role: 'assistant', content: mensagem.content });
      continue;
    }

    const pedidos = mensagem.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (pedidos.length === 0) return uso; // end_turn (ou outra parada sem ferramentas)

    if (mensagem.stop_reason === 'max_tokens') {
      throw new Error('A resposta foi cortada no meio de uma ferramenta (limite de tokens). Aumente o máximo de tokens do agente.');
    }

    historico.push({ role: 'assistant', content: mensagem.content });

    // Todas as respostas de ferramenta vão juntas numa única mensagem do usuário.
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const pedido of pedidos) {
      if (sinal.aborted) throw new Error('Execução cancelada.');
      const entradaTexto = JSON.stringify(pedido.input ?? {});
      aoEvento({ tipo: 'ferramenta', id: pedido.id, nome: pedido.name, entrada: resumir(entradaTexto), fase: 'inicio' });

      let resultado: ResultadoFerramenta;
      const definicao = porNome.get(pedido.name);
      if (!definicao) {
        resultado = { conteudo: `Ferramenta desconhecida: ${pedido.name}`, erro: true };
      } else {
        const valido = definicao.validar.safeParse(pedido.input);
        if (!valido.success) {
          resultado = { conteudo: `Entrada inválida: ${valido.error.issues[0]?.message ?? 'formato incorreto'}`, erro: true };
        } else {
          try {
            resultado = await executar(pedido.name, valido.data);
          } catch (e) {
            resultado = { conteudo: e instanceof Error ? e.message : 'Erro ao executar a ferramenta.', erro: true };
          }
        }
      }
      uso.ferramentas += 1;
      aoEvento({
        tipo: 'ferramenta',
        id: pedido.id,
        nome: pedido.name,
        resultado: resumir(resultado.conteudo),
        erro: Boolean(resultado.erro),
        fase: 'fim',
      });
      resultados.push({
        type: 'tool_result',
        tool_use_id: pedido.id,
        content: resultado.conteudo.slice(0, 20000),
        is_error: resultado.erro || undefined,
      });
    }
    historico.push({ role: 'user', content: resultados });
  }

  throw new Error(`O agente passou de ${MAX_RODADAS_FERRAMENTAS} rodadas de ferramentas sem terminar.`);
};

function traduzirErro(e: unknown, modelo: string): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Chave da Anthropic inválida.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Limite de uso da Anthropic atingido. Tente de novo em instantes.');
  if (e instanceof Anthropic.NotFoundError) return new Error(`Modelo não encontrado: ${modelo}`);
  if (e instanceof Anthropic.APIError) return new Error(`Erro da Anthropic: ${e.message}`);
  return e instanceof Error ? e : new Error('Erro inesperado.');
}
