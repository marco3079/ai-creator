import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { Dataset } from '../../lib/tipos-api';
import { ROTULO_TAREFA, TIPOS_MODELO } from '../../lib/tipos-modelos';
import type {
  ConfigModelo,
  Modelo,
  OpcoesModelos,
  TarefaModelo,
  TipoDataset,
  TipoModelo,
} from '../../lib/tipos-modelos';
import { AreaTexto, Aviso, Botao, Campo, Carregando, Pagina, Selecao, Selo } from '../../ui';
import { Icone } from '../../ui/icones';
import { FormularioConfigModelo } from './FormularioConfig';
import { configPadraoCliente, datasetsAceitos, iconeTipo } from './comum';

const PASSOS = ['Tipo', 'Tarefa e dados', 'Configuração'];

// Selo de aviso no cartão de tipo (não impede a escolha).
type SeloTipo = { cor: 'amarelo' | 'vermelho'; texto: string } | null;

function seloDoTipo(tipo: TipoModelo, opcoes: OpcoesModelos | null): SeloTipo {
  if (!opcoes) return null;
  if (tipo === 'LLM_NUVEM' && !opcoes.llmNuvem.disponivel) {
    return { cor: 'amarelo', texto: 'chave não configurada' };
  }
  if (tipo === 'LLM_LOCAL') {
    if (!opcoes.llmLocal.disponivel) return { cor: 'vermelho', texto: 'serviço offline' };
    if (!opcoes.llmLocal.gpu) return { cor: 'amarelo', texto: 'sem GPU' };
  }
  return null;
}

// Leitores não criam modelos: voltam para a lista em vez de receber 403 ao final do assistente.
export function NovoModelo() {
  const { usuario } = useAuth();
  if (usuario?.perfil === 'LEITOR') return <Navigate to="/app/modelos" replace />;
  return <AssistenteNovoModelo />;
}

function AssistenteNovoModelo() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const tipoUrl = TIPOS_MODELO.find((t) => t.valor === params.get('tipo'))?.valor ?? null;
  const tarefaUrl = tipoUrl ? TIPOS_MODELO.find((t) => t.valor === tipoUrl)?.tarefas[0] ?? null : null;

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [tipo, setTipo] = useState<TipoModelo | null>(tipoUrl);
  const [tarefa, setTarefa] = useState<TarefaModelo | null>(tarefaUrl);
  const [config, setConfig] = useState<ConfigModelo | null>(
    tipoUrl && tarefaUrl ? configPadraoCliente(tipoUrl, tarefaUrl) : null,
  );
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tags, setTags] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criadoId, setCriadoId] = useState<number | null>(null);

  const opcoes = useDados<OpcoesModelos>('/modelos/opcoes');
  const datasets = useDados<Dataset[]>('/datasets');

  const tipoInfo = tipo ? TIPOS_MODELO.find((t) => t.valor === tipo) ?? null : null;
  const aceitos = tipo ? datasetsAceitos(tipo, tarefa) : [];
  const datasetsDisponiveis = (datasets.dados ?? []).filter((d) => aceitos.includes(d.tipo as TipoDataset));
  const datasetEscolhido = datasetsDisponiveis.find((d) => String(d.id) === datasetId) ?? null;

  function escolherTipo(t: TipoModelo) {
    const tar = TIPOS_MODELO.find((x) => x.valor === t)?.tarefas[0] ?? null;
    setTipo(t);
    setTarefa(tar);
    setConfig(tar ? configPadraoCliente(t, tar) : null);
    setDatasetId('');
  }

  // Trocar a tarefa volta a configuração ao padrão dela (ex.: TinyML de imagem tem outro padrão).
  function escolherTarefa(t: TarefaModelo) {
    if (!tipo) return;
    setTarefa(t);
    setConfig(configPadraoCliente(tipo, t));
    setDatasetId('');
  }

  const podeAvancar = passo === 1 ? tipo !== null : passo === 2 ? nome.trim() !== '' && tarefa !== null : true;

  async function criar(treinar: boolean) {
    if (!tipo || !tarefa || !config) return;
    setErro(null);
    if (treinar && !datasetId) {
      setErro('Escolha um dataset para treinar o modelo.');
      return;
    }
    setEnviando(true);

    let id = criadoId;
    if (id === null) {
      try {
        const modelo = await api.post<Modelo>('/modelos', {
          nome: nome.trim(),
          descricao: descricao.trim(),
          tipo,
          tarefa,
          datasetId: datasetId ? Number(datasetId) : null,
          config,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        });
        id = modelo.id;
        setCriadoId(id);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro inesperado');
        setEnviando(false);
        return;
      }
    }

    if (treinar) {
      try {
        await api.post(`/modelos/${id}/treinar`, {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro inesperado';
        setErro(`O modelo foi criado, mas o treino não iniciou: ${msg}`);
        setEnviando(false);
        return;
      }
    }

    navegar(`/app/modelos/${id}`);
  }

  return (
    <Pagina
      titulo="Novo modelo"
      acoes={
        <Link className="modelos-link" to="/app/modelos">
          Cancelar
        </Link>
      }
    >
      <ol className="modelo-passos" aria-label="Etapas do assistente">
        {PASSOS.map((rotulo, i) => {
          const n = i + 1;
          const estado = n === passo ? 'atual' : n < passo ? 'concluido' : 'pendente';
          return (
            <li
              key={rotulo}
              className={`modelo-passo modelo-passo-${estado}`}
              aria-current={n === passo ? 'step' : undefined}
            >
              <span className="modelo-passo-numero">{n}</span>
              <span>{rotulo}</span>
            </li>
          );
        })}
      </ol>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {passo === 1 && (
        <section className="modelo-assistente-passo">
          <h2 className="modelo-assistente-titulo">Que tipo de modelo você quer criar?</h2>
          <div className="modelo-tipos">
            {TIPOS_MODELO.map((t) => {
              const selecionado = tipo === t.valor;
              const selo = seloDoTipo(t.valor, opcoes.dados);
              return (
                <button
                  key={t.valor}
                  type="button"
                  className={selecionado ? 'modelo-tipo-cartao selecionado' : 'modelo-tipo-cartao'}
                  aria-pressed={selecionado}
                  onClick={() => escolherTipo(t.valor)}
                >
                  <span className={`modelo-cartao-icone modelo-tipo-${t.valor.toLowerCase()}`}>
                    <Icone nome={iconeTipo(t.valor)} tamanho={28} />
                  </span>
                  <strong>{t.rotulo}</strong>
                  <span className="modelo-tipo-descricao">{t.descricao}</span>
                  {selo && <Selo cor={selo.cor}>{selo.texto}</Selo>}
                </button>
              );
            })}
          </div>
          {opcoes.erro && <Aviso tipo="info">Não foi possível verificar os serviços agora.</Aviso>}
        </section>
      )}

      {passo === 2 && tipoInfo && (
        <section className="modelo-assistente-passo">
          <h2 className="modelo-assistente-titulo">Tarefa e dados</h2>
          <div className="formulario-grade">
            {tipoInfo.tarefas.length > 1 ? (
              <Selecao
                rotulo="Tarefa"
                valor={tarefa ?? ''}
                opcoes={tipoInfo.tarefas.map((t) => ({ valor: t, rotulo: ROTULO_TAREFA[t] }))}
                aoMudar={(v) => escolherTarefa(v as TarefaModelo)}
                obrigatorio
              />
            ) : (
              <p className="modelo-tarefa-unica">
                Tarefa: <strong>{tarefa ? ROTULO_TAREFA[tarefa] : ''}</strong>
              </p>
            )}
            <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
            <AreaTexto rotulo="Descrição" valor={descricao} aoMudar={setDescricao} linhas={3} />
            <Campo rotulo="Tags (separadas por vírgula)" valor={tags} aoMudar={setTags} />

            <div className="modelos-campo">
              {datasets.erro && <Aviso tipo="erro">{datasets.erro}</Aviso>}
              {datasets.carregando && <Carregando />}
              {!datasets.carregando && !datasets.erro && (
                <>
                  <Selecao
                    rotulo="Dataset"
                    valor={datasetId}
                    aoMudar={setDatasetId}
                    opcoes={datasetsDisponiveis.map((d) => ({ valor: String(d.id), rotulo: `${d.nome} (${d.tipo})` }))}
                    vazio={datasetsDisponiveis.length ? 'Sem dataset por enquanto' : 'Nenhum dataset compatível'}
                  />
                  {datasetEscolhido && (
                    <small className="modelos-ajuda">
                      Classes: {datasetEscolhido.classes.length ? datasetEscolhido.classes.join(', ') : '—'} ·{' '}
                      {datasetEscolhido.amostras} amostras
                    </small>
                  )}
                </>
              )}
              <Link className="modelos-link" to="/app/datasets">
                Criar dataset
              </Link>
            </div>
          </div>
        </section>
      )}

      {passo === 3 && tipo && tarefa && (
        <section className="modelo-assistente-passo">
          <h2 className="modelo-assistente-titulo">Configuração</h2>
          {opcoes.erro && <Aviso tipo="erro">{opcoes.erro}</Aviso>}
          {!opcoes.erro && (!config || !opcoes.dados) && <Carregando />}
          {config && opcoes.dados && (
            <FormularioConfigModelo
              tipo={tipo}
              tarefa={tarefa}
              valor={config}
              aoMudar={setConfig}
              opcoes={opcoes.dados}
            />
          )}
        </section>
      )}

      <div className="modelo-assistente-acoes">
        {passo > 1 && (
          <Botao variante="secundario" desabilitado={enviando} aoClicar={() => setPasso((passo - 1) as 1 | 2)}>
            Voltar
          </Botao>
        )}
        {passo < 3 && (
          <Botao desabilitado={!podeAvancar} aoClicar={() => setPasso((passo + 1) as 2 | 3)}>
            Próximo
          </Botao>
        )}
        {passo === 3 && (
          <>
            <Botao variante="secundario" desabilitado={enviando} aoClicar={() => criar(false)}>
              Criar
            </Botao>
            <Botao desabilitado={enviando || !config} aoClicar={() => criar(true)}>
              Criar e treinar
            </Botao>
          </>
        )}
      </div>
    </Pagina>
  );
}
