import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Aviso, Botao, Campo, Carregando, Cartao, Modal, Selecao, Selo } from '../../ui';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { PLACAS, rotuloStatus, corStatus } from '../../lib/tipos-api';
import type { Agente, AgenteResumo, Build, BuildResumo, Placa, Projeto } from '../../lib/tipos-api';
import type { ModeloResumo, TreinoModeloResumo } from '../../lib/tipos-modelos';
import { ArvoreArquivos } from './ArvoreArquivos';
import { EditorCodigo } from './EditorCodigo';
import { Gravador } from './Gravador';
import './firmware.css';

const STATUS_FINAIS = ['SUCESSO', 'FALHA', 'CANCELADO'];

type ModalArquivo = { modo: 'novo' } | { modo: 'renomear'; caminho: string };

function rotuloPlaca(placa: string): string {
  return PLACAS.find((p) => p.valor === placa)?.rotulo ?? placa;
}

function maisRecente(builds: BuildResumo[]): BuildResumo {
  return [...builds].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
}

export function EditorProjeto() {
  const { id } = useParams();
  const { dados: projeto, carregando, erro, recarregar } = useDados<Projeto>(`/projetos/${id}`);
  const pid = projeto?.id;

  // Editor de arquivos
  const [ativo, setAtivo] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState('');
  const [original, setOriginal] = useState('');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [modalArquivo, setModalArquivo] = useState<ModalArquivo | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [salvandoModal, setSalvandoModal] = useState(false);
  const naoSalvo = ativo !== null && conteudo !== original;

  // Compilação. "Embutir modelo" guarda o tipo no valor: 'a:<agenteId>' (agente TinyML) ou 't:<treinoId>' (modelo treinado).
  const [embutido, setEmbutido] = useState('');
  const agenteId = embutido.startsWith('a:') ? embutido.slice(2) : '';
  const [compilando, setCompilando] = useState(false);
  const [buildAtual, setBuildAtual] = useState<Build | null>(null);
  const [erroBuild, setErroBuild] = useState<string | null>(null);

  const { dados: agentes } = useDados<AgenteResumo[]>('/agentes?tipo=TINYML');
  const { dados: agenteEscolhido } = useDados<Agente>(agenteId ? `/agentes/${agenteId}` : null);
  const { dados: builds, recarregar: recarregarBuilds } = useDados<BuildResumo[]>(
    pid !== undefined ? `/builds?projetoId=${pid}` : null,
  );

  // Modelos treinados (TinyML e Clássico) e os treinos concluídos de cada um, para o seletor "Embutir modelo".
  const { dados: modelosTinyml } = useDados<ModeloResumo[]>('/modelos?tipo=TINYML');
  const { dados: modelosTabular } = useDados<ModeloResumo[]>('/modelos?tipo=TABULAR');
  const [treinosPorModelo, setTreinosPorModelo] = useState<Record<number, TreinoModeloResumo[]>>({});

  useEffect(() => {
    const modelos = [...(modelosTinyml ?? []), ...(modelosTabular ?? [])];
    if (modelos.length === 0) return;
    let cancelado = false;
    Promise.all(modelos.map(async (m) => [m.id, await api.get<TreinoModeloResumo[]>(`/modelos/${m.id}/treinos`)] as const))
      .then((pares) => {
        if (cancelado) return;
        const mapa: Record<number, TreinoModeloResumo[]> = {};
        for (const [id, treinos] of pares) mapa[id] = treinos;
        setTreinosPorModelo(mapa);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [modelosTinyml, modelosTabular]);

  const modelosTreinados = [...(modelosTinyml ?? []), ...(modelosTabular ?? [])]
    .flatMap((m) =>
      (treinosPorModelo[m.id] ?? [])
        .filter((t) => t.status === 'SUCESSO')
        .map((t) => ({
          id: t.id,
          publicado: t.publicado,
          rotulo: `${m.nome} v${t.numero}${t.publicado ? ' (publicado)' : ''}`,
        })),
    )
    .sort((a, b) => Number(b.publicado) - Number(a.publicado));

  // Ao abrir a tela, mostra o build mais recente deste projeto (para gravar sem recompilar).
  useEffect(() => {
    if (buildAtual || !builds || builds.length === 0) return;
    let cancelado = false;
    api
      .get<Build>(`/builds/${maisRecente(builds).id}`)
      .then((b) => {
        if (!cancelado) setBuildAtual(b);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [builds, buildAtual]);

  // Acompanha a compilação em andamento com polling de 2 s até terminar.
  useEffect(() => {
    if (!buildAtual || STATUS_FINAIS.includes(buildAtual.status)) return;
    const timer = setTimeout(async () => {
      try {
        const atualizado = await api.get<Build>(`/builds/${buildAtual.id}`);
        setBuildAtual(atualizado);
        if (STATUS_FINAIS.includes(atualizado.status)) recarregarBuilds();
      } catch (e) {
        setErroBuild(e instanceof Error ? e.message : 'Erro ao acompanhar a compilação');
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [buildAtual, recarregarBuilds]);

  async function carregarArquivo(caminho: string) {
    if (pid === undefined) return;
    setAtivo(caminho);
    setCarregandoArquivo(true);
    setErroArquivo(null);
    setAviso(null);
    try {
      const r = await api.get<{ caminho: string; conteudo: string }>(
        `/projetos/${pid}/arquivo?caminho=${encodeURIComponent(caminho)}`,
      );
      setConteudo(r.conteudo);
      setOriginal(r.conteudo);
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Erro ao abrir o arquivo');
    } finally {
      setCarregandoArquivo(false);
    }
  }

  function abrir(caminho: string) {
    if (caminho === ativo) return;
    if (naoSalvo && !window.confirm('Descartar as alterações não salvas?')) return;
    void carregarArquivo(caminho);
  }

  // Salva o arquivo aberto. Devolve true se gravou.
  async function salvar(): Promise<boolean> {
    if (pid === undefined || ativo === null) return false;
    try {
      await api.put(`/projetos/${pid}/arquivo`, { caminho: ativo, conteudo });
      setOriginal(conteudo);
      setAviso('Arquivo salvo.');
      recarregar();
      return true;
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Erro ao salvar');
      return false;
    }
  }

  function abrirModalNovo() {
    setNomeArquivo('src/');
    setErroModal(null);
    setModalArquivo({ modo: 'novo' });
  }

  function abrirModalRenomear(caminho: string) {
    setNomeArquivo(caminho);
    setErroModal(null);
    setModalArquivo({ modo: 'renomear', caminho });
  }

  async function confirmarModal(e: FormEvent) {
    e.preventDefault();
    if (pid === undefined || !modalArquivo) return;
    const novoCaminho = nomeArquivo.trim();
    if (!novoCaminho) return;
    setSalvandoModal(true);
    setErroModal(null);
    try {
      if (modalArquivo.modo === 'novo') {
        await api.put(`/projetos/${pid}/arquivo`, { caminho: novoCaminho, conteudo: '' });
        setModalArquivo(null);
        recarregar();
        setAtivo(novoCaminho);
        setConteudo('');
        setOriginal('');
        setAviso(null);
      } else {
        const antigo = modalArquivo.caminho;
        if (novoCaminho !== antigo) {
          // Renomear = criar com o mesmo conteúdo + apagar o antigo.
          const conteudoAtual =
            antigo === ativo
              ? conteudo
              : (
                  await api.get<{ conteudo: string }>(
                    `/projetos/${pid}/arquivo?caminho=${encodeURIComponent(antigo)}`,
                  )
                ).conteudo;
          await api.put(`/projetos/${pid}/arquivo`, { caminho: novoCaminho, conteudo: conteudoAtual });
          await api.del(`/projetos/${pid}/arquivo?caminho=${encodeURIComponent(antigo)}`);
          setModalArquivo(null);
          recarregar();
          if (antigo === ativo) {
            setAtivo(novoCaminho);
            setConteudo(conteudoAtual);
            setOriginal(conteudoAtual);
          }
        } else {
          setModalArquivo(null);
        }
      }
    } catch (err) {
      setErroModal(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setSalvandoModal(false);
    }
  }

  async function excluir(caminho: string) {
    if (pid === undefined) return;
    if (!window.confirm(`Excluir o arquivo "${caminho}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.del(`/projetos/${pid}/arquivo?caminho=${encodeURIComponent(caminho)}`);
      if (caminho === ativo) {
        setAtivo(null);
        setConteudo('');
        setOriginal('');
      }
      recarregar();
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  }

  async function trocarPlaca(placa: string) {
    if (pid === undefined || !placa) return;
    try {
      await api.put(`/projetos/${pid}`, { placa: placa as Placa });
      recarregar();
      if (ativo === 'platformio.ini' && !naoSalvo) void carregarArquivo('platformio.ini');
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : 'Erro ao trocar a placa');
    }
  }

  async function compilar() {
    if (pid === undefined) return;
    setErroBuild(null);
    setCompilando(true);
    // O build usa os arquivos salvos no servidor: salva o que está aberto antes.
    if (naoSalvo && !(await salvar())) {
      setCompilando(false);
      return;
    }
    try {
      const corpo = embutido.startsWith('t:')
        ? { modeloTreinoId: Number(embutido.slice(2)) }
        : agenteId
          ? { agenteId: Number(agenteId) }
          : {};
      const b = await api.post<Build>(`/projetos/${pid}/build`, corpo);
      setBuildAtual(b);
      recarregarBuilds();
    } catch (e) {
      setErroBuild(e instanceof Error ? e.message : 'Erro ao compilar');
    } finally {
      setCompilando(false);
    }
  }

  if (carregando && !projeto) return <Carregando />;
  if (erro || !projeto) {
    return (
      <div className="pagina">
        <Aviso tipo="erro">{erro ?? 'Projeto não encontrado.'}</Aviso>
        <Link to="/app/projetos">Voltar para projetos</Link>
      </div>
    );
  }

  const emAndamento = buildAtual !== null && !STATUS_FINAIS.includes(buildAtual.status);
  const treinoPronto = agenteEscolhido?.configTinyml?.ultimoTreinoId != null;

  return (
    <section className="pagina firmware-projeto">
      <header className="firmware-projeto-cabecalho">
        <div>
          <Link to="/app/projetos" className="firmware-voltar">← Projetos</Link>
          <h1>{projeto.nome}</h1>
          {projeto.descricao && <p className="firmware-texto">{projeto.descricao}</p>}
        </div>
        <div className="firmware-projeto-placa">
          <Selo cor="azul">{rotuloPlaca(projeto.placa)}</Selo>
          <Selecao
            rotulo="Trocar placa"
            valor={projeto.placa}
            aoMudar={trocarPlaca}
            opcoes={PLACAS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
          />
        </div>
      </header>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erroArquivo && <Aviso tipo="erro">{erroArquivo}</Aviso>}

      <div className="firmware-ide">
        <aside className="firmware-coluna-arvore">
          <ArvoreArquivos
            arquivos={projeto.arquivos}
            ativo={ativo}
            aoAbrir={abrir}
            aoNovo={abrirModalNovo}
            aoRenomear={abrirModalRenomear}
            aoExcluir={excluir}
          />
        </aside>

        <main className="firmware-coluna-editor">
          {ativo === null ? (
            <p className="firmware-vazio">Escolha um arquivo na árvore para editar.</p>
          ) : (
            <EditorCodigo
              caminho={ativo}
              valor={conteudo}
              aoMudar={setConteudo}
              aoSalvar={() => void salvar()}
              naoSalvo={naoSalvo}
              carregando={carregandoArquivo}
            />
          )}
        </main>

        <aside className="firmware-coluna-painel">
          <Cartao titulo="Compilar">
            <label className="campo">
              <span className="campo-rotulo">Embutir modelo</span>
              <select className="campo-controle" value={embutido} onChange={(e) => setEmbutido(e.target.value)}>
                <option value="">Nenhum (sem modelo)</option>
                {(agentes ?? []).length > 0 && (
                  <optgroup label="Agentes TinyML">
                    {(agentes ?? []).map((a) => (
                      <option key={a.id} value={'a:' + a.id}>
                        {a.nome}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelosTreinados.length > 0 && (
                  <optgroup label="Modelos treinados">
                    {modelosTreinados.map((m) => (
                      <option key={m.id} value={'t:' + m.id}>
                        {m.rotulo}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {agenteId && agenteEscolhido && !treinoPronto && (
              <Aviso tipo="info">
                Este agente ainda não tem treino concluído. O modelo não será embutido.
              </Aviso>
            )}
            <Botao desabilitado={compilando || emAndamento} aoClicar={compilar}>
              {compilando || emAndamento ? 'Compilando...' : 'Compilar'}
            </Botao>
            {erroBuild && <Aviso tipo="erro">{erroBuild}</Aviso>}

            {buildAtual && (
              <div className="firmware-build">
                <div className="firmware-build-topo">
                  <span>Build #{buildAtual.id}</span>
                  <Selo cor={corStatus(buildAtual.status)}>{rotuloStatus(buildAtual.status)}</Selo>
                </div>
                {buildAtual.log && <pre className="firmware-log">{buildAtual.log}</pre>}
              </div>
            )}

            {buildAtual?.status === 'SUCESSO' && (
              <div className="firmware-gravar">
                <h3>Gravar</h3>
                <Gravador build={buildAtual} />
              </div>
            )}
          </Cartao>
        </aside>
      </div>

      <Modal
        aberto={modalArquivo !== null}
        titulo={modalArquivo?.modo === 'renomear' ? 'Renomear arquivo' : 'Novo arquivo'}
        aoFechar={() => setModalArquivo(null)}
      >
        <form className="firmware-form" onSubmit={confirmarModal}>
          <Campo
            rotulo="Caminho (ex.: src/sensor.cpp)"
            valor={nomeArquivo}
            aoMudar={setNomeArquivo}
            obrigatorio
          />
          {erroModal && <Aviso tipo="erro">{erroModal}</Aviso>}
          <div className="firmware-acoes-modal">
            <Botao variante="secundario" aoClicar={() => setModalArquivo(null)}>
              Cancelar
            </Botao>
            <Botao tipo="submit" desabilitado={salvandoModal || nomeArquivo.trim() === ''}>
              {salvandoModal ? 'Salvando...' : 'Confirmar'}
            </Botao>
          </div>
        </form>
      </Modal>
    </section>
  );
}
