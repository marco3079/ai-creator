import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { lerEventos } from '../../lib/sse';
import { useDados } from '../../lib/useDados';
import type { MensagemChat } from '../../lib/tipos-api';
import { Aviso, Botao, Carregando, formatarDataHora } from '../../ui';

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
}

// Eventos do SSE de /agentes/:id/executar (CONTRATOS §3).
type EventoExecucao =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fim'; uso: Uso }
  | { tipo: 'erro'; erro: string };

// Acrescenta trecho de texto à última mensagem (a resposta do assistente que está chegando).
function acrescentar(lista: MensagemChat[], texto: string): MensagemChat[] {
  if (lista.length === 0) return lista;
  const copia = [...lista];
  const ultima = copia[copia.length - 1];
  copia[copia.length - 1] = { ...ultima, content: ultima.content + texto };
  return copia;
}

export function Playground({ agenteId, pendente }: { agenteId: number; pendente: boolean }) {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
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

  // Cancela a execução se a tela sair.
  useEffect(() => () => controle.current?.abort(), []);

  // Mantém a última mensagem visível enquanto o texto chega.
  useEffect(() => {
    fimDasMensagens.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || executando || pendente) return;

    const historico: MensagemChat[] = [...mensagens, { role: 'user', content: texto }];
    setMensagens([...historico, { role: 'assistant', content: '' }]);
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
          if (e.tipo === 'texto') setMensagens((m) => acrescentar(m, e.texto));
          else if (e.tipo === 'fim') setUso(e.uso);
          else if (e.tipo === 'erro') setErro(e.erro);
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
    setMensagens([]);
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
      setMensagens(c.mensagens);
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
          {mensagens.length === 0 && (
            <p className="agentes-ajuda">Envie uma mensagem para testar o agente.</p>
          )}
          {mensagens.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'agente-balao agente-balao-usuario'
                  : 'agente-balao agente-balao-assistente'
              }
            >
              {m.content}
            </div>
          ))}
          <div ref={fimDasMensagens} />
        </div>

        {uso && (
          <p className="agentes-ajuda">
            Tokens: entrada {uso.entrada} · saída {uso.saida}
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
