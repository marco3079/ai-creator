import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { lerEventos } from '../../lib/sse';
import { useDados } from '../../lib/useDados';
import type { MensagemChat } from '../../lib/tipos-api';
import { FERRAMENTAS_PLATAFORMA } from '../../lib/tipos-melhorias';
import type { EventoExecucao } from '../../lib/tipos-melhorias';
import { Aviso, Botao, Carregando, Icone, formatarDataHora } from '../../ui';
import { iconeDaPlataforma } from './FormularioLlm';

interface ConversaResumo {
  id: number;
  titulo: string;
  atualizadoEm: string;
}

interface ConversaCompleta {
  id: number;
  titulo: string;
  mensagens: MensagemChat[];
}

interface Uso {
  entrada: number;
  saida: number;
  custoUsd: number | null;
}

// Cartão de uma chamada de ferramenta (só na tela; não é salvo na conversa).
interface CartaoFerramenta {
  tipo: 'ferramenta';
  id: string;
  nome: string; // nome sem o prefixo "aic." (como o servidor envia)
  entrada: string;
  resultado: string;
  erro: boolean;
  concluida: boolean;
}

interface ItemMensagem {
  tipo: 'mensagem';
  msg: MensagemChat;
}

// A conversa mostrada: mensagens e cartões de ferramenta na ordem em que aconteceram.
type Item = ItemMensagem | CartaoFerramenta;

// Acrescenta trecho de texto à última mensagem (a resposta do assistente que está chegando).
// Se a última coisa na tela é um cartão de ferramenta, abre um balão novo depois dele.
function acrescentarTexto(itens: Item[], texto: string): Item[] {
  const ultimo = itens[itens.length - 1];
  if (ultimo && ultimo.tipo === 'mensagem' && ultimo.msg.role === 'assistant') {
    const copia = [...itens];
    copia[copia.length - 1] = { tipo: 'mensagem', msg: { ...ultimo.msg, content: ultimo.msg.content + texto } };
    return copia;
  }
  return [...itens, { tipo: 'mensagem', msg: { role: 'assistant', content: texto } }];
}

// Histórico enviado ao servidor (e salvo): sem cartões, sem mensagens vazias e sem papéis repetidos
// em sequência (textos seguidos do mesmo papel viram uma mensagem, separados por linha em branco).
export function montarHistorico(itens: Item[]): MensagemChat[] {
  const saida: MensagemChat[] = [];
  for (const item of itens) {
    if (item.tipo !== 'mensagem') continue;
    const conteudo = item.msg.content.trim();
    if (conteudo === '') continue;
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === item.msg.role) {
      saida[saida.length - 1] = { role: ultima.role, content: `${ultima.content}\n\n${conteudo}` };
    } else {
      saida.push({ role: item.msg.role, content: conteudo });
    }
  }
  return saida;
}

function concluirFerramenta(itens: Item[], id: string, resultado: string, erro: boolean): Item[] {
  return itens.map((item) =>
    item.tipo === 'ferramenta' && item.id === id ? { ...item, resultado, erro, concluida: true } : item,
  );
}

function formatarCusto(custo: number | null): string {
  if (custo == null) return 'sem preço cadastrado';
  return `US$ ${custo.toFixed(4).replace('.', ',')}`;
}

function CartaoFerramentaView({ c }: { c: CartaoFerramenta }) {
  const nomeCompleto = `aic.${c.nome}`;
  const rotulo = FERRAMENTAS_PLATAFORMA.find((f) => f.nome === nomeCompleto)?.rotulo ?? c.nome;
  const situacao = !c.concluida ? 'executando…' : c.erro ? 'erro' : 'concluída';
  return (
    <details className={c.concluida && c.erro ? 'agente-ferramenta agente-ferramenta-erro' : 'agente-ferramenta'}>
      <summary>
        <Icone nome={iconeDaPlataforma(nomeCompleto)} tamanho={16} />
        <span className="agente-ferramenta-rotulo">{rotulo}</span>
        <small>{situacao}</small>
      </summary>
      <div className="agente-ferramenta-corpo">
        <strong>Entrada</strong>
        <pre>{c.entrada}</pre>
        {c.concluida && (
          <>
            <strong>{c.erro ? 'Erro' : 'Resultado'}</strong>
            <pre>{c.resultado}</pre>
          </>
        )}
      </div>
    </details>
  );
}

export function Playground({ agenteId, pendente }: { agenteId: number; pendente: boolean }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [entrada, setEntrada] = useState('');
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [conversaId, setConversaId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const controle = useRef<AbortController | null>(null);
  const fimDasMensagens = useRef<HTMLDivElement>(null);
  const conversas = useDados<ConversaResumo[]>(`/agentes/${agenteId}/conversas`);

  // Só as mensagens (sem os cartões) formam o histórico enviado e salvo.
  const mensagens = useMemo(() => montarHistorico(itens), [itens]);

  // Cancela a execução se a tela sair.
  useEffect(() => () => controle.current?.abort(), []);

  // Mantém a última mensagem visível enquanto o texto chega.
  useEffect(() => {
    fimDasMensagens.current?.scrollIntoView({ block: 'end' });
  }, [itens]);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || executando || pendente) return;

    const historico: MensagemChat[] = [...mensagens, { role: 'user', content: texto }];
    setItens((atuais) => [
      ...atuais,
      { tipo: 'mensagem', msg: { role: 'user', content: texto } },
      { tipo: 'mensagem', msg: { role: 'assistant', content: '' } },
    ]);
    setEntrada('');
    setErro(null);
    setAviso(null);
    setUso(null);
    setExecutando(true);

    const ctrl = new AbortController();
    controle.current = ctrl;
    try {
      await lerEventos(
        `/agentes/${agenteId}/executar`,
        { mensagens: historico },
        (ev) => {
          const e = ev as EventoExecucao;
          if (e.tipo === 'texto') {
            const trecho = e.texto;
            setItens((atuais) => acrescentarTexto(atuais, trecho));
          } else if (e.tipo === 'ferramenta') {
            if (e.fase === 'inicio') {
              const cartao: CartaoFerramenta = {
                tipo: 'ferramenta',
                id: e.id,
                nome: e.nome,
                entrada: e.entrada,
                resultado: '',
                erro: false,
                concluida: false,
              };
              setItens((atuais) => [...atuais, cartao]);
            } else {
              const { id, resultado, erro: falhou } = e;
              setItens((atuais) => concluirFerramenta(atuais, id, resultado, falhou));
            }
          } else if (e.tipo === 'fim') {
            setUso(e.uso);
          } else if (e.tipo === 'erro') {
            setErro(e.erro);
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      // Parar pelo botão não é erro: a resposta parcial fica na tela.
      if (!ctrl.signal.aborted) setErro(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      controle.current = null;
      setExecutando(false);
    }
  }

  function parar() {
    controle.current?.abort();
  }

  function teclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  function novaConversa() {
    setItens([]);
    setConversaId(null);
    setUso(null);
    setErro(null);
    setAviso(null);
  }

  async function abrirConversa(id: number) {
    setErro(null);
    setAviso(null);
    try {
      const c = await api.get<ConversaCompleta>(`/conversas/${id}`);
      setItens(c.mensagens.map((msg) => ({ tipo: 'mensagem' as const, msg })));
      setConversaId(c.id);
      setUso(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
    }
  }

  async function salvarConversa() {
    const msgs = mensagens.filter((m) => m.content.trim() !== '');
    if (msgs.length === 0) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      if (conversaId !== null) {
        await api.put(`/conversas/${conversaId}`, { mensagens: msgs });
        setAviso('Conversa atualizada.');
      } else {
        const primeira = msgs.find((m) => m.role === 'user')?.content ?? 'Conversa';
        const titulo = primeira.slice(0, 60);
        const criada = await api.post<ConversaCompleta>(`/agentes/${agenteId}/conversas`, {
          titulo,
          mensagens: msgs,
        });
        setConversaId(criada.id);
        setAviso('Conversa salva.');
      }
      conversas.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="agentes-playground">
      <aside className="agentes-conversas" aria-label="Conversas salvas">
        <div className="agentes-conversas-cabecalho">
          <strong>Conversas salvas</strong>
          <Botao variante="texto" aoClicar={novaConversa}>
            Nova
          </Botao>
        </div>
        {conversas.erro && <Aviso tipo="erro">{conversas.erro}</Aviso>}
        {conversas.carregando && <Carregando />}
        {conversas.dados && conversas.dados.length === 0 && (
          <p className="agentes-ajuda">Nenhuma conversa salva.</p>
        )}
        {conversas.dados && conversas.dados.length > 0 && (
          <ul className="agentes-lista-conversas">
            {conversas.dados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === conversaId ? 'agentes-conversa agentes-conversa-ativa' : 'agentes-conversa'}
                  onClick={() => abrirConversa(c.id)}
                >
                  <span>{c.titulo}</span>
                  <small>{formatarDataHora(c.atualizadoEm)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="agentes-chat">
        {pendente && (
          <Aviso tipo="info">
            Salve o agente antes de testar: há alterações na configuração que ainda não foram salvas.
          </Aviso>
        )}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="agentes-mensagens" aria-live="polite">
          {itens.length === 0 && (
            <p className="agentes-ajuda">Envie uma mensagem para testar o agente.</p>
          )}
          {itens.map((item, i) => {
            if (item.tipo === 'ferramenta') {
              return <CartaoFerramentaView key={`f-${item.id}`} c={item} />;
            }
            // Balão vazio do assistente (ainda sem texto, ou só com ferramentas): não aparece.
            if (item.msg.role === 'assistant' && item.msg.content === '') return null;
            return (
              <div
                key={i}
                className={
                  item.msg.role === 'user'
                    ? 'agente-balao agente-balao-usuario'
                    : 'agente-balao agente-balao-assistente'
                }
              >
                {item.msg.content}
              </div>
            );
          })}
          <div ref={fimDasMensagens} />
        </div>

        {uso && (
          <p className="agentes-ajuda">
            Tokens: entrada {uso.entrada} · saída {uso.saida} · {formatarCusto(uso.custoUsd)}
          </p>
        )}

        <div className="agentes-entrada">
          <textarea
            className="campo-controle"
            rows={3}
            aria-label="Mensagem"
            placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={teclar}
          />
          <div className="agentes-entrada-acoes">
            {executando ? (
              <Botao variante="perigo" aoClicar={parar}>
                Parar
              </Botao>
            ) : (
              <Botao desabilitado={pendente || entrada.trim() === ''} aoClicar={enviar}>
                Enviar
              </Botao>
            )}
            <Botao
              variante="secundario"
              desabilitado={salvando || executando || mensagens.length === 0}
              aoClicar={salvarConversa}
            >
              Salvar conversa
            </Botao>
          </div>
        </div>
      </section>
    </div>
  );
}
