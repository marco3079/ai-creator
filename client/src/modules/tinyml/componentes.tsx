import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { PLACAS, rotuloStatus, corStatus } from '../../lib/tipos-api';
import type { ConfigTinyml, Dataset, MetricasTreino, Treino, TreinoResumo, StatusJob } from '../../lib/tipos-api';
import { Aviso, Botao, Campo, Carregando, Cartao, Selecao, Selo } from '../../ui';
import { MatrizConfusao } from './MatrizConfusao';
import './tinyml.css';

// ---------- Utilitários ----------

const CHAVE_TOKEN = 'aicreator.token';

// Converte o texto de um campo numérico; campo vazio ou inválido vira 0 (o servidor valida os limites).
function numero(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

// Baixa um arquivo protegido por autenticação: a rota exige o token, então usa fetch e cria um link temporário.
export async function baixarComToken(caminho: string, nomeArquivo: string): Promise<void> {
  const token = localStorage.getItem(CHAVE_TOKEN);
  const resposta = await fetch('/api' + caminho, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resposta.ok) {
    let mensagem = 'Não foi possível baixar o arquivo.';
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados.erro) mensagem = dados.erro;
    } catch {
      // resposta sem JSON: mantém a mensagem padrão
    }
    throw new Error(mensagem);
  }
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

function emAndamento(status: StatusJob): boolean {
  return status === 'FILA' || status === 'EXECUTANDO';
}

function formatarBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

function formatarNumero(n: number, casas = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas });
}

const ARQUITETURAS: { valor: string; rotulo: string; descricao: string }[] = [
  {
    valor: 'DENSA',
    rotulo: 'Densa',
    descricao: 'Camadas totalmente conectadas. Simples e muito leve; boa para janelas curtas.',
  },
  {
    valor: 'CNN1D',
    rotulo: 'CNN 1D',
    descricao: 'Convoluções sobre a série temporal. Captura padrões locais em sinais como vibração e áudio.',
  },
  {
    valor: 'DS_CNN',
    rotulo: 'DS-CNN',
    descricao: 'Convolução separável em profundidade. Mais leve que a CNN 1D, indicada para microcontroladores.',
  },
];

const TIPOS_ENTRADA: { valor: string; rotulo: string }[] = [
  { valor: 'SERIE_TEMPORAL', rotulo: 'Série temporal (sensores)' },
  { valor: 'AUDIO', rotulo: 'Áudio' },
  { valor: 'TABELA', rotulo: 'Tabela de atributos' },
];

const QUANTIZACOES: { valor: string; rotulo: string; descricao: string }[] = [
  { valor: 'INT8', rotulo: 'INT8', descricao: 'Pesos em 1 byte. Ocupa menos flash e RAM; é o recomendado para microcontroladores.' },
  { valor: 'FLOAT32', rotulo: 'FLOAT32', descricao: 'Pesos em 4 bytes. Maior precisão, porém ocupa quatro vezes mais espaço.' },
];

// ---------- Chips de classes ----------

function EditorClasses({
  classes,
  aoMudar,
  somenteLeitura,
}: {
  classes: string[];
  aoMudar: (classes: string[]) => void;
  somenteLeitura?: boolean;
}) {
  const [nova, setNova] = useState('');

  // Sem elemento de formulário: este componente fica dentro do formulário do Editor, e um form aninhado é HTML inválido.
  function adicionar() {
    const texto = nova.trim();
    if (!texto || classes.includes(texto)) {
      setNova('');
      return;
    }
    aoMudar([...classes, texto]);
    setNova('');
  }

  return (
    <div className="tinyml-classes">
      <div className="tinyml-chips">
        {classes.length === 0 && <span className="tinyml-ajuda">Nenhuma classe definida.</span>}
        {classes.map((c) => (
          <span key={c} className="tinyml-chip">
            {c}
            {!somenteLeitura && (
              <button
                type="button"
                className="tinyml-chip-remover"
                aria-label={`Remover classe ${c}`}
                onClick={() => aoMudar(classes.filter((x) => x !== c))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!somenteLeitura && (
        // Enter no campo adiciona a classe e impede o envio implícito do formulário externo.
        <div
          className="tinyml-linha"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
              adicionar();
            }
          }}
        >
          <Campo rotulo="Nova classe" valor={nova} aoMudar={setNova} />
          <Botao tipo="button" variante="secundario" desabilitado={!nova.trim()} aoClicar={adicionar}>
            Adicionar
          </Botao>
        </div>
      )}
    </div>
  );
}

// ---------- Formulário de configuração TinyML ----------

export function FormularioTinyml({
  valor,
  aoMudar,
  somenteLeitura,
}: {
  valor: ConfigTinyml;
  aoMudar: (v: ConfigTinyml) => void;
  somenteLeitura?: boolean;
}) {
  const desabilitado = somenteLeitura;

  function mudar(parcial: Partial<ConfigTinyml>) {
    aoMudar({ ...valor, ...parcial });
  }

  function mudarEntrada(parcial: Partial<ConfigTinyml['entrada']>) {
    aoMudar({ ...valor, entrada: { ...valor.entrada, ...parcial } });
  }

  // Estimativa simples do tamanho do modelo (não substitui a medição real feita no treino).
  // Entrada = canais x janela. Parâmetros = entrada x neurônios + neurônios^2 x (camadas-1) + neurônios x classes.
  const entradaTamanho = valor.entrada.canais * valor.entrada.janela;
  const parametros =
    entradaTamanho * valor.neuronios +
    valor.neuronios * valor.neuronios * (valor.camadas - 1) +
    valor.neuronios * valor.classes.length;
  const bytesPorPeso = valor.quantizacao === 'INT8' ? 1 : 4;
  const tamanhoKb = (parametros * bytesPorPeso) / 1024;
  const estourouFlash = tamanhoKb > valor.limiteFlashKb;

  const arquitetura = ARQUITETURAS.find((a) => a.valor === valor.arquitetura);
  const quantizacao = QUANTIZACOES.find((q) => q.valor === valor.quantizacao);

  return (
    <div className="tinyml-formulario">
      <Cartao titulo="Entrada">
        <div className="grade">
          <Selecao
            rotulo="Tipo de entrada"
            valor={valor.entrada.tipo}
            aoMudar={(v) => mudarEntrada({ tipo: v as ConfigTinyml['entrada']['tipo'] })}
            opcoes={TIPOS_ENTRADA}
          />
          <Campo
            rotulo="Canais"
            tipo="number"
            valor={String(valor.entrada.canais)}
            aoMudar={(v) => mudarEntrada({ canais: numero(v) })}
          />
          <Campo
            rotulo="Janela (amostras)"
            tipo="number"
            valor={String(valor.entrada.janela)}
            aoMudar={(v) => mudarEntrada({ janela: numero(v) })}
          />
          <Campo
            rotulo="Frequência (Hz)"
            tipo="number"
            valor={String(valor.entrada.frequenciaHz)}
            aoMudar={(v) => mudarEntrada({ frequenciaHz: numero(v) })}
          />
        </div>
      </Cartao>

      <Cartao titulo="Classes">
        <EditorClasses
          classes={valor.classes}
          aoMudar={(classes) => mudar({ classes })}
          somenteLeitura={desabilitado}
        />
      </Cartao>

      <Cartao titulo="Modelo">
        <div className="grade">
          <Selecao
            rotulo="Arquitetura"
            valor={valor.arquitetura}
            aoMudar={(v) => mudar({ arquitetura: v as ConfigTinyml['arquitetura'] })}
            opcoes={ARQUITETURAS.map((a) => ({ valor: a.valor, rotulo: a.rotulo }))}
          />
          <Campo
            rotulo="Camadas (1 a 6)"
            tipo="number"
            valor={String(valor.camadas)}
            aoMudar={(v) => mudar({ camadas: numero(v) })}
          />
          <Campo
            rotulo="Neurônios por camada (4 a 256)"
            tipo="number"
            valor={String(valor.neuronios)}
            aoMudar={(v) => mudar({ neuronios: numero(v) })}
          />
          <Campo
            rotulo="Épocas (1 a 500)"
            tipo="number"
            valor={String(valor.epocas)}
            aoMudar={(v) => mudar({ epocas: numero(v) })}
          />
          <Campo
            rotulo="Taxa de aprendizado"
            tipo="number"
            valor={String(valor.taxaAprendizado)}
            aoMudar={(v) => mudar({ taxaAprendizado: numero(v) })}
          />
          <Selecao
            rotulo="Quantização"
            valor={valor.quantizacao}
            aoMudar={(v) => mudar({ quantizacao: v as ConfigTinyml['quantizacao'] })}
            opcoes={QUANTIZACOES.map((q) => ({ valor: q.valor, rotulo: q.rotulo }))}
          />
        </div>
        {arquitetura && <p className="tinyml-ajuda">{arquitetura.descricao}</p>}
        {quantizacao && <p className="tinyml-ajuda">{quantizacao.descricao}</p>}
      </Cartao>

      <Cartao titulo="Placa-alvo">
        <div className="grade">
          <Selecao
            rotulo="Placa"
            valor={valor.placaAlvo}
            aoMudar={(v) => mudar({ placaAlvo: v as ConfigTinyml['placaAlvo'] })}
            opcoes={PLACAS}
          />
          <Campo
            rotulo="Limite de RAM (KB)"
            tipo="number"
            valor={String(valor.limiteRamKb)}
            aoMudar={(v) => mudar({ limiteRamKb: numero(v) })}
          />
          <Campo
            rotulo="Limite de flash (KB)"
            tipo="number"
            valor={String(valor.limiteFlashKb)}
            aoMudar={(v) => mudar({ limiteFlashKb: numero(v) })}
          />
        </div>
        <p className="tinyml-estimativa">
          Estimativa: {formatarNumero(parametros)} parâmetros, cerca de {formatarNumero(tamanhoKb, 1)} KB
          ({quantizacao?.rotulo ?? valor.quantizacao}) de {formatarNumero(valor.limiteFlashKb)} KB de flash.
        </p>
        {estourouFlash && (
          <Aviso tipo="erro">
            O modelo estimado passa do limite de flash da placa. Reduza neurônios ou camadas, use INT8 ou
            aumente o limite.
          </Aviso>
        )}
      </Cartao>
    </div>
  );
}

// ---------- Matriz de confusão e métricas do treino ----------

function formatarPorcentagem(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  // Aceita tanto fração (0 a 1) quanto porcentagem (0 a 100).
  const pct = v <= 1 ? v * 100 : v;
  return `${formatarNumero(pct, 1)}%`;
}

function MetricasTreino({ metricas }: { metricas: MetricasTreino | null }) {
  if (!metricas || (metricas.acuracia === undefined && metricas.acuraciaValidacao === undefined && metricas.perda === undefined)) {
    return <p className="tinyml-ajuda">Sem métricas para este treino.</p>;
  }

  return (
    <dl className="tinyml-metricas">
      <div>
        <dt>Acurácia</dt>
        <dd>{formatarPorcentagem(metricas.acuracia)}</dd>
      </div>
      <div>
        <dt>Acurácia (val.)</dt>
        <dd>{formatarPorcentagem(metricas.acuraciaValidacao)}</dd>
      </div>
      <div>
        <dt>Perda</dt>
        <dd>{metricas.perda === undefined ? "—" : formatarNumero(metricas.perda, 4)}</dd>
      </div>
    </dl>
  );
}

// Log com auto-scroll: acompanha o fim enquanto o usuário não rolou para cima.
function LogTreino({ log }: { log: string }) {
  const [elemento, setElemento] = useState<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!elemento) return;
    const distancia = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight;
    if (distancia < 40 || elemento.scrollTop === 0) elemento.scrollTop = elemento.scrollHeight;
  }, [log, elemento]);

  return (
    <pre ref={setElemento} className="tinyml-log">
      {log || 'Sem log ainda.'}
    </pre>
  );
}

// ---------- Aba de treino ----------

export function AbaTreino({ agenteId, config }: { agenteId: number; config: ConfigTinyml }) {
  const datasets = useDados<Dataset[]>('/datasets');
  const [datasetId, setDatasetId] = useState<string>(config.datasetId ? String(config.datasetId) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(config.ultimoTreinoId);

  const lista = useDados<TreinoResumo[]>(`/treinos?agenteId=${agenteId}`);
  const detalhe = useDados<Treino>(selecionadoId !== null ? `/treinos/${selecionadoId}` : null);

  // Polling a cada 3 s enquanto houver treino na fila ou executando.
  const listaEmAndamento = (lista.dados ?? []).some((t) => emAndamento(t.status));
  useEffect(() => {
    if (!listaEmAndamento) return;
    const t = window.setTimeout(() => lista.recarregar(), 3000);
    return () => window.clearTimeout(t);
    // recarregar é estável; o efeito reage só à mudança de dados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaEmAndamento, lista.dados]);

  const detalheEmAndamento = detalhe.dados !== null && emAndamento(detalhe.dados.status);
  useEffect(() => {
    if (!detalheEmAndamento) return;
    const t = window.setTimeout(() => detalhe.recarregar(), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalheEmAndamento, detalhe.dados]);

  const datasetEscolhido = datasets.dados?.find((d) => String(d.id) === datasetId) ?? null;

  // Compara as classes do dataset com as do agente, sem depender da ordem.
  const classesDiferem =
    datasetEscolhido !== null &&
    (datasetEscolhido.classes.length !== config.classes.length ||
      datasetEscolhido.classes.some((c) => !config.classes.includes(c)));

  async function treinar() {
    if (!datasetId) return;
    setErro(null);
    setOcupado(true);
    try {
      const treino = await api.post<Treino>(`/agentes/${agenteId}/treinar`, {
        datasetId: Number(datasetId),
      });
      setSelecionadoId(treino.id);
      lista.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function baixar(caminho: string, nome: string) {
    setErro(null);
    try {
      await baixarComToken(caminho, nome);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const t = detalhe.dados;
  const modeloPronto = t !== null && t.status === "SUCESSO";
  const matriz = t?.metricas?.matrizConfusao;
  const matrizValida =
    Array.isArray(matriz) && matriz.length > 0 && matriz.every((linha) => Array.isArray(linha));

  return (
    <div className="tinyml-treino">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao titulo="Treinar">
        {datasets.erro && <Aviso tipo="erro">{datasets.erro}</Aviso>}
        {datasets.carregando && !datasets.dados && <Carregando />}
        {datasets.dados && datasets.dados.length === 0 && (
          <p className="tinyml-ajuda">Nenhum dataset cadastrado. Crie um na tela Datasets.</p>
        )}
        {datasets.dados && datasets.dados.length > 0 && (
          <>
            <div className="tinyml-linha">
              <Selecao
                rotulo="Dataset"
                valor={datasetId}
                aoMudar={setDatasetId}
                vazio="Selecione um dataset"
                opcoes={datasets.dados.map((d) => ({
                  valor: String(d.id),
                  rotulo: `${d.nome} (${d.amostras} amostras, ${d.classes.length} classes)`,
                }))}
              />
              <Botao aoClicar={treinar} desabilitado={!datasetId || ocupado}>
                {ocupado ? 'Enviando...' : 'Treinar'}
              </Botao>
            </div>
            {datasetEscolhido && (
              <p className="tinyml-ajuda">
                Classes do dataset: {datasetEscolhido.classes.join(', ') || 'nenhuma'}.
              </p>
            )}
            {classesDiferem && (
              <Aviso tipo="info">
                As classes do dataset são diferentes das classes deste agente. O treino usa as classes do
                dataset; ajuste o formulário se quiser que coincidam.
              </Aviso>
            )}
          </>
        )}
      </Cartao>

      <Cartao titulo="Treinos">
        {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados && lista.dados.length === 0 && (
          <p className="tinyml-ajuda">Nenhum treino ainda.</p>
        )}
        {lista.dados && lista.dados.length > 0 && (
          <ul className="tinyml-lista-treinos">
            {lista.dados.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selecionadoId ? 'tinyml-treino-item tinyml-treino-ativo' : 'tinyml-treino-item'}
                  onClick={() => setSelecionadoId(item.id)}
                >
                  <span>Treino #{item.id}</span>
                  <Selo cor={corStatus(item.status)}>{rotuloStatus(item.status)}</Selo>
                  <span className="tinyml-ajuda">
                    {new Date(item.criadoEm).toLocaleString('pt-BR')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {selecionadoId !== null && (
        <Cartao titulo={`Detalhe do treino #${selecionadoId}`}>
          {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
          {detalhe.carregando && !t && <Carregando />}
          {t && (
            <>
              <div className="tinyml-linha">
                <Selo cor={corStatus(t.status)}>{rotuloStatus(t.status)}</Selo>
                <span className="tinyml-ajuda">Tamanho do modelo: {formatarBytes(t.tamanhoBytes)}</span>
              </div>

              <h3 className="tinyml-subtitulo">Log</h3>
              <LogTreino log={t.log ?? ''} />

              <h3 className="tinyml-subtitulo">Métricas</h3>
              <MetricasTreino metricas={t.metricas} />

              {matrizValida && (
                <>
                  <h3 className="tinyml-subtitulo">Matriz de confusão</h3>
                  <MatrizConfusao matriz={matriz as number[][]} classes={t.metricas?.classes ?? config.classes} />
                </>
              )}

              <h3 className="tinyml-subtitulo">Arquivos</h3>
              <div className="tinyml-linha">
                <Botao
                  variante="secundario"
                  desabilitado={!modeloPronto}
                  aoClicar={() => baixar(`/treinos/${t.id}/modelo.tflite`, `modelo-${t.id}.tflite`)}
                >
                  Baixar .tflite
                </Botao>
                <Botao
                  variante="secundario"
                  desabilitado={!modeloPronto}
                  aoClicar={() => baixar(`/treinos/${t.id}/model_data.h`, 'model_data.h')}
                >
                  Baixar model_data.h
                </Botao>
              </div>
              {!modeloPronto && (
                <p className="tinyml-ajuda">Os arquivos ficam disponíveis quando o treino termina com sucesso.</p>
              )}
            </>
          )}
        </Cartao>
      )}
    </div>
  );
}
