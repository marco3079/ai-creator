import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { AtualizacaoDTO, Commit, EstadoAtualizacao } from '../../lib/tipos-atualizacao';
import { Aviso, Botao, Carregando, Cartao, Modal, Pagina, Selo, formatarDataHora } from '../../ui';
import './atualizacao.css';

type Disponivel = { disponivel: true } & EstadoAtualizacao;
type Tarefa = EstadoAtualizacao['tarefa'];

// Etapas na ordem do atualizador (contrato §3 e §4).
const ETAPAS = ['Copiando o banco', 'Baixando o código', 'Reconstruindo', 'Reiniciando'];

// Consulta de acompanhamento: uma por vez, a cada 2 s, encadeada com setTimeout.
const INTERVALO_CONSULTA_MS = 2000;
// Depois de iniciar, se a tarefa não aparecer como EXECUTANDO nesse tempo, para de esperar.
const TOLERANCIA_INICIO_MS = 15 * 1000;
// Acompanha a busca no GitHub (verificando) por no máximo 3 minutos.
const LIMITE_VERIFICACAO_MS = 3 * 60 * 1000;
// Depois de concluída, o botão de recarregar aparece só por 10 minutos.
const JANELA_RECARREGAR_MS = 10 * 60 * 1000;

const AVISO_ATUALIZADOR =
  'O serviço de atualização também mudou. Rode `.\\atualizar.ps1` ou `sh atualizar.sh` na pasta do projeto para atualizá-lo.';

const AVISO_REINICIANDO = 'Reiniciando… aguardando o servidor voltar. A página continua tentando sozinha.';

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => window.setTimeout(resolver, ms));
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Índice da etapa a partir do texto que o atualizador envia (ex.: "Reconstruindo").
function indiceEtapa(etapa: string): number {
  const alvo = semAcento(etapa);
  const i = ETAPAS.findIndex((e) => alvo.includes(semAcento(e).split(' ')[0]));
  return i < 0 ? 0 : i;
}

// 512 B, 1,5 KB, 2,3 MB.
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function DetalheCommit({ info }: { info: Commit | null }) {
  if (!info) return <p className="atualizacao-ajuda">Nenhum commit conhecido.</p>;
  return (
    <div className="atualizacao-commit">
      <div className="atualizacao-commit-topo">
        <code className="atualizacao-codigo">{info.curto}</code>
        <span className="atualizacao-ajuda">{formatarDataHora(info.data) || '—'}</span>
      </div>
      <p className="atualizacao-mensagem">{info.mensagem}</p>
    </div>
  );
}

function SituacaoRemoto({ d }: { d: Disponivel }) {
  if (d.remoto === null) return <Selo cor="cinza">Sem informação</Selo>;
  if (d.atras > 0) {
    return (
      <Selo cor="amarelo">
        {`${d.atras} commit${d.atras === 1 ? '' : 's'} atrás`}
      </Selo>
    );
  }
  if (d.precisaReconstruir) return <Selo cor="amarelo">Reconstrução pendente</Selo>;
  return <Selo cor="verde">Atualizado</Selo>;
}

function Etapas({ tarefa }: { tarefa: Tarefa }) {
  const atual = tarefa.estado === 'CONCLUIDA' ? ETAPAS.length : indiceEtapa(tarefa.etapa);
  return (
    <ol className="atualizacao-etapas">
      {ETAPAS.map((rotulo, i) => {
        let situacao: 'feita' | 'atual' | 'erro' | 'pendente';
        if (i < atual) {
          situacao = 'feita';
        } else if (i === atual) {
          if (tarefa.estado === 'FALHOU') situacao = 'erro';
          else if (tarefa.estado === 'CONCLUIDA') situacao = 'feita';
          else situacao = 'atual';
        } else {
          situacao = 'pendente';
        }
        return (
          <li
            key={rotulo}
            className={`atualizacao-etapa atualizacao-etapa-${situacao}`}
            aria-current={situacao === 'atual' ? 'step' : undefined}
          >
            {rotulo}
          </li>
        );
      })}
    </ol>
  );
}

// Log com rolagem que acompanha o fim.
function LogTarefa({ linhas }: { linhas: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  const texto = linhas.join('\n');
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [texto]);
  return (
    <pre ref={ref} className="atualizacao-log" aria-label="Registro da atualização">
      {texto || 'Sem saída ainda.'}
    </pre>
  );
}

function TarefaAtualizacao({ tarefa, reiniciando }: { tarefa: Tarefa; reiniciando: boolean }) {
  if (tarefa.estado === 'EXECUTANDO') {
    return (
      <Cartao titulo="Atualização em andamento">
        {reiniciando && <Aviso tipo="info">{AVISO_REINICIANDO}</Aviso>}
        <Etapas tarefa={tarefa} />
        <p className="atualizacao-ajuda">
          Etapa atual: <strong>{tarefa.etapa}</strong>
        </p>
        <LogTarefa linhas={tarefa.log} />
      </Cartao>
    );
  }
  if (tarefa.estado === 'CONCLUIDA') {
    const fim = tarefa.terminadaEm ? new Date(tarefa.terminadaEm).getTime() : Date.now();
    if (Date.now() - fim > JANELA_RECARREGAR_MS) {
      return (
        <Cartao titulo="Última atualização">
          <p className="atualizacao-ajuda">
            Concluída em {new Date(fim).toLocaleString('pt-BR')}.
          </p>
        </Cartao>
      );
    }
    return (
      <Cartao titulo="Atualização">
        <Aviso tipo="sucesso">Atualização concluída. Recarregue a página para usar a versão nova.</Aviso>
        <div className="atualizacao-acoes">
          <Botao aoClicar={() => window.location.reload()}>Recarregar a página</Botao>
        </div>
        <LogTarefa linhas={tarefa.log} />
      </Cartao>
    );
  }
  if (tarefa.estado === 'FALHOU') {
    return (
      <Cartao titulo="Atualização">
        <Aviso tipo="erro">{tarefa.erro ?? 'A atualização falhou.'}</Aviso>
        <Etapas tarefa={tarefa} />
        <LogTarefa linhas={tarefa.log} />
      </Cartao>
    );
  }
  return null;
}

export function Atualizacao() {
  const [dados, setDados] = useState<AtualizacaoDTO | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Acompanhamento ativo. viuExecutando: já apareceu como EXECUTANDO (senão, a primeira leitura pode mostrar a tarefa anterior).
  const [acompanhando, setAcompanhando] = useState<{ inicio: number; viuExecutando: boolean } | null>(null);
  const [reiniciando, setReiniciando] = useState(false);

  const vivo = useRef(false);
  const verificandoRef = useRef(false);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // Verificação no GitHub (uma por vez). A busca roda em segundo plano no servidor: acompanha até terminar.
  const verificar = useCallback(async () => {
    if (verificandoRef.current) return;
    verificandoRef.current = true;
    setVerificando(true);
    setErroCarga(null);
    try {
      let novo = await api.get<AtualizacaoDTO>('/atualizacao?verificar=1');
      if (!vivo.current) return;
      setDados(novo);
      const limite = Date.now() + LIMITE_VERIFICACAO_MS;
      while (novo.disponivel && novo.verificando && Date.now() < limite) {
        await esperar(INTERVALO_CONSULTA_MS);
        if (!vivo.current) return;
        novo = await api.get<AtualizacaoDTO>('/atualizacao');
        if (!vivo.current) return;
        setDados(novo);
      }
      if (novo.disponivel && novo.tarefa.estado === 'EXECUTANDO') {
        setAcompanhando((atual) => atual ?? { inicio: Date.now(), viuExecutando: true });
      }
    } catch (e) {
      if (vivo.current) setErroCarga(mensagemErro(e));
    } finally {
      verificandoRef.current = false;
      if (vivo.current) setVerificando(false);
    }
  }, []);

  useEffect(() => {
    void verificar();
  }, [verificar]);

  // Acompanhamento da tarefa: uma consulta por vez. Erro de rede = servidor reiniciando: continua tentando até voltar.
  useEffect(() => {
    if (!acompanhando) return;
    let ativo = true;
    let timer: number | undefined;
    let viuExecutando = acompanhando.viuExecutando;
    const inicio = acompanhando.inicio;

    async function consultar() {
      try {
        const novo = await api.get<AtualizacaoDTO>('/atualizacao');
        if (!ativo) return;
        setReiniciando(false);
        setDados(novo);
        if (!novo.disponivel) {
          setAcompanhando(null);
          return;
        }
        if (novo.tarefa.estado === 'EXECUTANDO') {
          viuExecutando = true;
        } else if (viuExecutando || Date.now() - inicio > TOLERANCIA_INICIO_MS) {
          setAcompanhando(null);
          return;
        }
      } catch {
        // Falha de rede ou 502/503/504: a API está reiniciando. Não é erro; tenta de novo.
        if (!ativo) return;
        setReiniciando(true);
      }
      if (!ativo) return;
      timer = window.setTimeout(consultar, INTERVALO_CONSULTA_MS);
    }

    void consultar();
    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [acompanhando]);

  async function atualizar() {
    setConfirmando(false);
    setErroAcao(null);
    setEnviando(true);
    try {
      await api.post('/atualizacao');
      if (vivo.current) setAcompanhando({ inicio: Date.now(), viuExecutando: false });
    } catch (e) {
      if (vivo.current) {
        setErroAcao(mensagemErro(e));
        // Pode ser "já existe uma atualização em andamento": relê o estado para acompanhar.
        void verificar();
      }
    } finally {
      if (vivo.current) setEnviando(false);
    }
  }

  const carregando = dados === null && erroCarga === null;
  const d = dados !== null && dados.disponivel ? dados : null;
  const emAndamento = d !== null && d.tarefa.estado === 'EXECUTANDO';
  const podeAtualizar =
    d !== null &&
    (d.atras > 0 || d.precisaReconstruir) &&
    !emAndamento &&
    acompanhando === null &&
    !enviando;

  return (
    <Pagina
      titulo="Atualização"
      acoes={
        <Botao
          variante="secundario"
          desabilitado={verificando || acompanhando !== null}
          aoClicar={() => void verificar()}
        >
          {verificando ? 'Verificando...' : 'Verificar agora'}
        </Botao>
      }
    >
      <div className="atualizacao">
        {d !== null && d.verificadoEm && (
          <p className="atualizacao-ajuda">Verificado em {formatarDataHora(d.verificadoEm)}</p>
        )}

        {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
        {carregando && <Carregando />}
        {dados !== null && !dados.disponivel && (
          <Aviso tipo="info">
            {`${dados.motivo} Se a atualização não estiver configurada, rode o instalador de novo na pasta do projeto (instalar.ps1 ou instalar.sh).`}
          </Aviso>
        )}

        {d !== null && (
          <>
            {reiniciando && <Aviso tipo="info">{AVISO_REINICIANDO}</Aviso>}
            {d.erroVerificacao && <Aviso tipo="erro">{d.erroVerificacao}</Aviso>}
            {d.atualizadorMudou && <Aviso tipo="info">{AVISO_ATUALIZADOR}</Aviso>}

            <div className="atualizacao-cartoes">
              <Cartao titulo="Versão no ar">
                <DetalheCommit info={d.instalado} />
                <p className="atualizacao-ajuda">Ramo: {d.ramo ?? '—'}</p>
                <p className="atualizacao-ajuda">Repositório: {d.repositorio ?? '—'}</p>
              </Cartao>
              <Cartao titulo="Versão nova">
                <DetalheCommit info={d.remoto} />
                <div className="atualizacao-situacao">
                  <SituacaoRemoto d={d} />
                </div>
              </Cartao>
            </div>

            <div className="atualizacao-acoes">
              <Botao desabilitado={!podeAtualizar} aoClicar={() => setConfirmando(true)}>
                {enviando ? 'Iniciando...' : 'Atualizar agora'}
              </Botao>
            </div>

            <Cartao titulo="O que vem nesta atualização">
              {d.novidades.length === 0 ? (
                <p className="atualizacao-ajuda">Nenhuma novidade pendente.</p>
              ) : (
                <ul className="atualizacao-novidades">
                  {d.novidades.map((n) => (
                    <li key={n.curto} className="atualizacao-novidade">
                      <code className="atualizacao-codigo">{n.curto}</code>
                      <span className="atualizacao-novidade-texto">{n.mensagem}</span>
                      <span className="atualizacao-ajuda">{formatarDataHora(n.data)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>

            <Cartao titulo="Serviços que serão reconstruídos">
              {d.servicos.length === 0 ? (
                <p className="atualizacao-ajuda">Nenhum serviço precisa ser reconstruído.</p>
              ) : (
                <ul className="atualizacao-chips">
                  {d.servicos.map((s) => (
                    <li key={s} className="atualizacao-chip">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>

            <Cartao titulo="Cópias do banco">
              <Aviso tipo="info">
                Antes de cada atualização, o banco é copiado automaticamente. As cópias ficam na pasta
                backups/ do projeto, as 5 mais recentes.
              </Aviso>
              {d.copias.length === 0 ? (
                <p className="atualizacao-ajuda">Nenhuma cópia ainda.</p>
              ) : (
                <ul className="atualizacao-copias">
                  {d.copias.map((c) => (
                    <li key={c.nome} className="atualizacao-copia">
                      <code className="atualizacao-codigo">{c.nome}</code>
                      <span className="atualizacao-ajuda">{formatarTamanho(c.tamanhoBytes)}</span>
                      <span className="atualizacao-ajuda">{formatarDataHora(c.criadoEm) || '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>

            {d.tarefa.estado !== 'PARADA' && (
              <TarefaAtualizacao tarefa={d.tarefa} reiniciando={reiniciando} />
            )}
          </>
        )}
      </div>

      <Modal aberto={confirmando} titulo="Atualizar o sistema?" aoFechar={() => setConfirmando(false)}>
        <p>
          Antes de começar, o banco é copiado. Depois, o sistema baixa a versão nova, reconstrói os
          serviços que mudaram e reinicia. Leva alguns minutos e as pessoas conectadas podem ser
          desconectadas por instantes.
        </p>
        <div className="atualizacao-acoes">
          <Botao variante="secundario" aoClicar={() => setConfirmando(false)}>
            Cancelar
          </Botao>
          <Botao aoClicar={() => void atualizar()}>Atualizar agora</Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
