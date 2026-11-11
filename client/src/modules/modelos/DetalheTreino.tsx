import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { corStatus, rotuloStatus } from '../../lib/tipos-api';
import type { Modelo, TreinoModelo, MetricasModelo } from '../../lib/tipos-modelos';
import { Aviso, Botao, Carregando, Cartao, Selo, formatarDataHora } from '../../ui';
import { baixarComToken, mensagemErro } from '../tinyml/componentes';
import { MatrizConfusao } from '../tinyml/MatrizConfusao';
import { GraficoHistorico } from './GraficoHistorico';

// Detalhe de um treino: status, log, métricas, histórico, matriz, validação cruzada, artefatos e ações.

const INTERVALO_POLLING_MS = 3000;

function emAndamento(status: string): boolean {
  return status === 'FILA' || status === 'EXECUTANDO';
}

function formatarTamanho(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

// Métricas por tarefa: classificação/imagem, regressão e chat (LLM).
const CARTOES_POR_TAREFA: Record<string, { chave: keyof MetricasModelo; rotulo: string; percentual?: boolean; inteiro?: boolean }[]> = {
  CLASSIFICACAO: [
    { chave: 'acuracia', rotulo: 'Acurácia', percentual: true },
    { chave: 'acuraciaValidacao', rotulo: 'Acurácia (val.)', percentual: true },
    { chave: 'f1', rotulo: 'F1', percentual: true },
    { chave: 'precisao', rotulo: 'Precisão', percentual: true },
    { chave: 'recall', rotulo: 'Recall', percentual: true },
  ],
  IMAGEM: [
    { chave: 'acuracia', rotulo: 'Acurácia', percentual: true },
    { chave: 'acuraciaValidacao', rotulo: 'Acurácia (val.)', percentual: true },
    { chave: 'f1', rotulo: 'F1', percentual: true },
    { chave: 'precisao', rotulo: 'Precisão', percentual: true },
    { chave: 'recall', rotulo: 'Recall', percentual: true },
  ],
  REGRESSAO: [
    { chave: 'r2', rotulo: 'R²' },
    { chave: 'mae', rotulo: 'MAE' },
    { chave: 'rmse', rotulo: 'RMSE' },
  ],
  CHAT: [
    { chave: 'perda', rotulo: 'Perda' },
    { chave: 'perdaValidacao', rotulo: 'Perda (val.)' },
    { chave: 'tokensTreinados', rotulo: 'Tokens treinados', inteiro: true },
  ],
};

function formatarCartao(valor: unknown, percentual?: boolean, inteiro?: boolean): string {
  if (typeof valor !== 'number') return '—';
  if (percentual) {
    // Aceita fração (0 a 1) ou porcentagem (0 a 100), como no restante do módulo.
    const pct = valor <= 1 ? valor * 100 : valor;
    return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }
  if (inteiro) return valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function DetalheTreino({
  treinoId,
  modelo,
  podeEscrever,
  aoVoltar,
  aoAtualizar,
}: {
  treinoId: number;
  modelo: Modelo;
  podeEscrever: boolean;
  aoVoltar: () => void;
  aoAtualizar: () => void | Promise<void>;
}) {
  const navegar = useNavigate();
  const [treino, setTreino] = useState<TreinoModelo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // Muda a cada resposta (com sucesso ou erro): mantém o polling vivo mesmo se uma leitura falhar.
  const [ciclo, setCiclo] = useState(0);
  const viva = useRef(true);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    viva.current = true;
    return () => {
      viva.current = false;
    };
  }, []);

  async function carregar() {
    try {
      const dados = await api.get<TreinoModelo>(`/treinos-modelo/${treinoId}`);
      if (viva.current) {
        setTreino(dados);
        setErro(null);
      }
    } catch (e) {
      if (viva.current) setErro(mensagemErro(e));
    } finally {
      if (viva.current) {
        setCarregando(false);
        setCiclo((c) => c + 1);
      }
    }
  }

  useEffect(() => {
    void carregar();
    // carregar muda só com o id do treino
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treinoId]);

  const andamento = treino !== null && emAndamento(treino.status);
  useEffect(() => {
    if (!andamento) return;
    const t = window.setTimeout(() => void carregar(), INTERVALO_POLLING_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [andamento, ciclo]);

  // Auto-scroll do log: acompanha o fim enquanto o usuário não rolou para cima.
  const logAtual = treino?.log ?? '';
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const distancia = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distancia < 40 || el.scrollTop === 0) el.scrollTop = el.scrollHeight;
  }, [logAtual]);

  async function executar(caminho: string, aposSucesso?: (resposta: unknown) => void) {
    setOcupado(true);
    setErroAcao(null);
    try {
      const resposta = await api.post(caminho);
      aposSucesso?.(resposta);
      await carregar();
      await aoAtualizar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function baixar(nome: string) {
    if (!treino) return;
    setErroDownload(null);
    try {
      await baixarComToken(`/treinos-modelo/${treino.id}/artefatos/${encodeURIComponent(nome)}`, nome);
    } catch (e) {
      setErroDownload(mensagemErro(e));
    }
  }

  async function copiarNome(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErroAcao('Não foi possível copiar. Selecione o nome e copie manualmente.');
    }
  }

  if (!treino) {
    return (
      <Cartao>
        <Botao variante="secundario" aoClicar={aoVoltar}>
          Voltar à lista
        </Botao>
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </Cartao>
    );
  }

  const t = treino;
  const metricas = t.metricas;
  const tarefa = modelo.tarefa;
  const cartoes = CARTOES_POR_TAREFA[tarefa] ?? [];
  const historico = metricas?.historico ?? [];
  const matriz = metricas?.matrizConfusao;
  const matrizValida = Array.isArray(matriz) && matriz.length > 0 && matriz.every((linha) => Array.isArray(linha));
  const cruzada = metricas?.validacaoCruzada;
  const ehLlm = modelo.tipo === 'LLM_NUVEM' || modelo.tipo === 'LLM_LOCAL';
  const podePublicar = podeEscrever && t.status === 'SUCESSO' && !t.publicado;
  const podeCancelar = podeEscrever && emAndamento(t.status);
  const podeCriarAgente = podeEscrever && ehLlm && t.status === 'SUCESSO' && Boolean(t.modeloResultante);

  return (
    <div className="det-treino">
      <Cartao titulo={`Treino #${t.numero}`}>
        <div className="det-linha">
          <Selo cor={corStatus(t.status)}>{rotuloStatus(t.status)}</Selo>
          {t.publicado && <Selo cor="verde">publicado</Selo>}
          <span className="det-ajuda">Tamanho do modelo: {formatarTamanho(t.tamanhoBytes)}</span>
        </div>
        <p className="det-ajuda">
          Criado em {formatarDataHora(t.criadoEm)}
          {t.iniciadoEm && <> · iniciado em {formatarDataHora(t.iniciadoEm)}</>}
          {t.finalizadoEm && <> · finalizado em {formatarDataHora(t.finalizadoEm)}</>}
        </p>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

        <div className="det-acoes">
          <Botao variante="secundario" aoClicar={aoVoltar}>
            Voltar à lista
          </Botao>
          {podePublicar && (
            <Botao desabilitado={ocupado} aoClicar={() => executar(`/treinos-modelo/${t.id}/publicar`)}>
              Publicar
            </Botao>
          )}
          {podeCancelar && (
            <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => executar(`/treinos-modelo/${t.id}/cancelar`)}>
              Cancelar treino
            </Botao>
          )}
          {podeCriarAgente && (
            <Botao
              desabilitado={ocupado}
              aoClicar={() =>
                executar(`/treinos-modelo/${t.id}/criar-agente`, (resposta) => {
                  const agente = resposta as { id?: number } | undefined;
                  if (agente?.id !== undefined) navegar(`/app/agentes/${agente.id}`);
                })
              }
            >
              Criar agente
            </Botao>
          )}
        </div>

        {ehLlm && t.modeloResultante && (
          <div className="det-modelo-resultante">
            <span className="det-ajuda">Modelo resultante</span>
            <code>{t.modeloResultante}</code>
            <Botao variante="secundario" aoClicar={() => copiarNome(t.modeloResultante ?? '')}>
              {copiado ? 'Copiado' : 'Copiar'}
            </Botao>
          </div>
        )}
      </Cartao>

      {cartoes.length > 0 && (
        <Cartao titulo="Métricas">
          {metricas ? (
            <div className="det-metricas">
              {cartoes.map((c) => (
                <div key={c.chave} className="det-metrica">
                  <span>{c.rotulo}</span>
                  <strong>{formatarCartao(metricas[c.chave], c.percentual, c.inteiro)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="det-ajuda">Sem métricas para este treino.</p>
          )}
        </Cartao>
      )}

      {historico.length > 0 && (
        <Cartao titulo="Histórico por época">
          <GraficoHistorico historico={historico} rotuloMetrica={tarefa === 'CHAT' ? 'Perda (val.)' : 'Métrica'} />
        </Cartao>
      )}

      {matrizValida && (
        <Cartao titulo="Matriz de confusão">
          <MatrizConfusao matriz={matriz as number[][]} classes={metricas?.classes ?? []} />
        </Cartao>
      )}

      {cruzada && (
        <Cartao titulo="Validação cruzada">
          <p>
            Média{' '}
            <strong>{cruzada.media.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</strong> ± desvio{' '}
            {cruzada.desvio.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ({cruzada.k} dobras)
          </p>
        </Cartao>
      )}

      <Cartao titulo="Log">
        <pre ref={logRef} className="det-log">
          {logAtual || 'Sem log ainda.'}
        </pre>
      </Cartao>

      <Cartao titulo="Artefatos">
        {erroDownload && <Aviso tipo="erro">{erroDownload}</Aviso>}
        {t.artefatos.length === 0 ? (
          <p className="det-ajuda">Nenhum artefato até o treino terminar com sucesso.</p>
        ) : (
          <ul className="det-artefatos">
            {t.artefatos.map((a) => (
              <li key={a.nome}>
                <span className="det-artefato-nome">{a.nome}</span>
                <Selo>{a.tipo}</Selo>
                <span className="det-ajuda">{formatarTamanho(a.tamanhoBytes)}</span>
                <Botao variante="secundario" aoClicar={() => baixar(a.nome)}>
                  Baixar
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <details className="det-detalhes">
        <summary>Parâmetros usados</summary>
        <pre className="det-json">{JSON.stringify(t.parametros, null, 2)}</pre>
      </details>
    </div>
  );
}
