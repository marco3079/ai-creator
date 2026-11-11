import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { ROTULO_TAREFA } from '../../lib/tipos-modelos';
import type { ConfigModelo, Modelo, OpcoesModelos, TipoDataset } from '../../lib/tipos-modelos';
import { Abas, Aviso, Botao, Campo, Carregando, Cartao, Icone, Modal, Pagina, Selecao, Selo } from '../../ui';
import { mensagemErro } from '../tinyml/componentes';
import { FormularioConfigModelo } from './FormularioConfig';
import { datasetsAceitos, iconeTipo, rotuloTipo } from './comum';
import { AbaTreinos } from './AbaTreinos';
import { DetalheTreino } from './DetalheTreino';
import { Comparar } from './Comparar';
import { AbaUsar } from './AbaUsar';
import './detalhe.css';

// Tela de detalhe de um modelo (rota /app/modelos/:id). Abas: Treinos, Comparar, Configuração, Usar.

const INTERVALO_POLLING_MS = 3000;

interface DatasetOpcao {
  id: number;
  nome: string;
  tipo: TipoDataset;
  amostras: number;
}

function emAndamento(status: string): boolean {
  return status === 'FILA' || status === 'EXECUTANDO';
}

export function DetalheModelo() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const podeEscrever = usuario?.perfil !== 'LEITOR';
  const opcoes = useDados<OpcoesModelos>('/modelos/opcoes');

  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Muda a cada resposta (com sucesso ou erro). Mantém o polling vivo mesmo se uma leitura falhar.
  const [ciclo, setCiclo] = useState(0);
  const [aba, setAba] = useState('treinos');
  const [treinoAbertoId, setTreinoAbertoId] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState<ConfigModelo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // Modal "Treinar"
  const [modalAberto, setModalAberto] = useState(false);
  const [datasetEscolhido, setDatasetEscolhido] = useState('');
  const [epocas, setEpocas] = useState('');
  const [algoritmo, setAlgoritmo] = useState('');
  const [enviandoTreino, setEnviandoTreino] = useState(false);
  const [erroTreino, setErroTreino] = useState<string | null>(null);
  const datasets = useDados<DatasetOpcao[]>(modalAberto ? '/datasets' : null);

  const viva = useRef(true);
  useEffect(() => {
    viva.current = true;
    return () => {
      viva.current = false;
    };
  }, []);

  async function carregar() {
    if (!id) return;
    try {
      const dados = await api.get<Modelo>(`/modelos/${id}`);
      if (viva.current) {
        setModelo(dados);
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
    setCarregando(true);
    setModelo(null);
    setTreinoAbertoId(null);
    setRascunho(null);
    void carregar();
    // carregar muda só com o id da rota
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Polling de 3 s enquanto algum treino estiver na fila ou executando.
  const algumEmAndamento = modelo?.treinos.some((t) => emAndamento(t.status)) ?? false;
  useEffect(() => {
    if (!algumEmAndamento) return;
    const t = window.setTimeout(() => void carregar(), INTERVALO_POLLING_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algumEmAndamento, ciclo]);

  function abrirTreinar() {
    if (!modelo) return;
    setDatasetEscolhido(modelo.datasetId !== null ? String(modelo.datasetId) : '');
    const epocasAtuais = 'epocas' in modelo.config ? modelo.config.epocas : null;
    setEpocas(epocasAtuais !== null ? String(epocasAtuais) : '');
    setAlgoritmo('algoritmo' in modelo.config ? modelo.config.algoritmo : '');
    setErroTreino(null);
    setModalAberto(true);
  }

  function montarParametros(): Record<string, unknown> | undefined {
    if (!modelo) return undefined;
    const config = modelo.config;
    if (modelo.tipo === 'TINYML' || modelo.tipo === 'LLM_LOCAL') {
      return epocas.trim() ? { epocas: Number(epocas) } : undefined;
    }
    if (modelo.tipo === 'LLM_NUVEM') {
      return { epocas: epocas.trim() ? Number(epocas) : null };
    }
    // TABULAR: ao trocar o algoritmo, envia os hiperparâmetros padrão do novo algoritmo.
    if (modelo.tipo === 'TABULAR' && 'algoritmo' in config && algoritmo && algoritmo !== config.algoritmo) {
      const alvo = opcoes.dados?.tabular.algoritmos.find((a) => a.valor === algoritmo);
      const hiperparametros: Record<string, number | string | boolean> = {};
      for (const h of alvo?.hiperparametros ?? []) hiperparametros[h.nome] = h.padrao;
      return { algoritmo, hiperparametros };
    }
    return undefined;
  }

  async function treinar() {
    if (!modelo) return;
    if (!datasetEscolhido) {
      setErroTreino('Escolha um dataset.');
      return;
    }
    setEnviandoTreino(true);
    setErroTreino(null);
    try {
      await api.post(`/modelos/${modelo.id}/treinar`, {
        datasetId: Number(datasetEscolhido),
        parametros: montarParametros(),
      });
      setModalAberto(false);
      setAba('treinos');
      setTreinoAbertoId(null);
      setMensagem('Treino enviado. Acompanhe o status na lista.');
      await carregar();
    } catch (e) {
      setErroTreino(mensagemErro(e));
    } finally {
      setEnviandoTreino(false);
    }
  }

  async function salvarConfiguracao() {
    if (!modelo || !rascunho) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.put(`/modelos/${modelo.id}`, { config: rascunho });
      setRascunho(null);
      setMensagem('Configuração salva.');
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!modelo) {
    return (
      <Pagina titulo="Modelo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && <Carregando />}
        {!carregando && !erro && <Aviso tipo="info">Modelo não encontrado.</Aviso>}
        <Botao variante="secundario" aoClicar={() => navegar('/app/modelos')}>
          Voltar
        </Botao>
      </Pagina>
    );
  }

  const publicado = modelo.publicado;
  const aceitos = datasetsAceitos(modelo.tipo, modelo.tarefa);
  const datasetsCompativeis = (datasets.dados ?? []).filter((d) => aceitos.includes(d.tipo));
  const algoritmosDisponiveis = (opcoes.dados?.tabular.algoritmos ?? []).filter((a) =>
    a.tarefas.includes(modelo.tarefa),
  );

  return (
    <Pagina
      titulo={modelo.nome}
      acoes={
        <>
          <Botao variante="secundario" aoClicar={() => navegar('/app/modelos')}>
            Voltar
          </Botao>
          {podeEscrever && <Botao aoClicar={abrirTreinar}>Treinar</Botao>}
        </>
      }
    >
      <div className="det-resumo">
        <Icone nome={iconeTipo(modelo.tipo)} tamanho={40} className="det-icone" />
        <Selo cor="azul">{rotuloTipo(modelo.tipo)}</Selo>
        <Selo>{ROTULO_TAREFA[modelo.tarefa]}</Selo>
        {modelo.dataset ? (
          <Selo cor="verde">Dataset: {modelo.dataset.nome}</Selo>
        ) : (
          <Selo cor="amarelo">Sem dataset padrão</Selo>
        )}
        {publicado ? (
          <Selo cor="verde">Publicado: treino #{publicado.numero}</Selo>
        ) : (
          <Selo cor="amarelo">Nenhuma versão publicada</Selo>
        )}
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {mensagem && <Aviso tipo="sucesso">{mensagem}</Aviso>}

      <Abas
        abas={[
          { id: 'treinos', rotulo: 'Treinos' },
          { id: 'comparar', rotulo: 'Comparar' },
          { id: 'configuracao', rotulo: 'Configuração' },
          { id: 'usar', rotulo: 'Usar' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />

      {aba === 'treinos' &&
        (treinoAbertoId !== null ? (
          <DetalheTreino
            key={treinoAbertoId}
            treinoId={treinoAbertoId}
            modelo={modelo}
            podeEscrever={podeEscrever}
            aoVoltar={() => setTreinoAbertoId(null)}
            aoAtualizar={carregar}
          />
        ) : (
          <AbaTreinos treinos={modelo.treinos} aoAbrir={setTreinoAbertoId} />
        ))}

      {aba === 'comparar' && <Comparar modelo={modelo} treinos={modelo.treinos} />}

      {aba === 'configuracao' &&
        (opcoes.dados ? (
          <>
            <FormularioConfigModelo
              tipo={modelo.tipo}
              tarefa={modelo.tarefa}
              valor={rascunho ?? modelo.config}
              aoMudar={setRascunho}
              opcoes={opcoes.dados}
              somenteLeitura={!podeEscrever}
            />
            {podeEscrever && (
              <div className="det-acoes">
                <Botao desabilitado={!rascunho || salvando} aoClicar={salvarConfiguracao}>
                  {salvando ? 'Salvando...' : 'Salvar configuração'}
                </Botao>
                {rascunho && (
                  <Botao variante="texto" aoClicar={() => setRascunho(null)}>
                    Descartar alterações
                  </Botao>
                )}
              </div>
            )}
          </>
        ) : opcoes.erro ? (
          <Aviso tipo="erro">{opcoes.erro}</Aviso>
        ) : (
          <Carregando />
        ))}

      {aba === 'usar' && <AbaUsar modelo={modelo} treinos={modelo.treinos} podeEscrever={podeEscrever} />}

      <Modal aberto={modalAberto} titulo="Treinar modelo" aoFechar={() => setModalAberto(false)}>
        <div className="det-modal">
          {datasets.erro && <Aviso tipo="erro">{datasets.erro}</Aviso>}
          {datasets.carregando && !datasets.dados && <Carregando />}
          {datasets.dados && datasetsCompativeis.length === 0 && (
            <Aviso tipo="info">Nenhum dataset compatível com este tipo de modelo.</Aviso>
          )}
          {datasetsCompativeis.length > 0 && (
            <Selecao
              rotulo="Dataset"
              valor={datasetEscolhido}
              aoMudar={setDatasetEscolhido}
              vazio="Selecione um dataset"
              obrigatorio
              opcoes={datasetsCompativeis.map((d) => ({
                valor: String(d.id),
                rotulo: `${d.nome} (${d.amostras} amostras)`,
              }))}
            />
          )}

          <h3 className="det-subtitulo">Ajustes rápidos</h3>
          {modelo.tipo === 'TABULAR' && (
            <Selecao
              rotulo="Algoritmo"
              valor={algoritmo}
              aoMudar={setAlgoritmo}
              opcoes={algoritmosDisponiveis.map((a) => ({ valor: a.valor, rotulo: a.rotulo }))}
            />
          )}
          {modelo.tipo === 'TINYML' && (
            <Campo rotulo="Épocas" tipo="number" valor={epocas} aoMudar={setEpocas} />
          )}
          {modelo.tipo === 'LLM_LOCAL' && (
            <Campo rotulo="Épocas (1 a 10)" tipo="number" valor={epocas} aoMudar={setEpocas} />
          )}
          {modelo.tipo === 'LLM_NUVEM' && (
            <Campo rotulo="Épocas (vazio = automático)" tipo="number" valor={epocas} aoMudar={setEpocas} />
          )}

          {erroTreino && <Aviso tipo="erro">{erroTreino}</Aviso>}
          <div className="det-acoes">
            <Botao desabilitado={enviandoTreino || !datasetEscolhido} aoClicar={treinar}>
              {enviandoTreino ? 'Enviando...' : 'Iniciar treino'}
            </Botao>
            <Botao variante="secundario" aoClicar={() => setModalAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      </Modal>
    </Pagina>
  );
}
