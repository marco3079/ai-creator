import { useState } from 'react';
import type { FormEvent } from 'react';
import { Aviso, Botao, Campo, Carregando, Selecao, Selo, formatarData } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { compararArquivos, diffLinhas } from './diff';
import type { ArquivoTexto, BlocoDiff } from './diff';
import './historico.css';

// Histórico do projeto (B06): versões manuais e automáticas, diff, restaurar e exportar como Git.

const CHAVE_TOKEN = 'aicreator.token';

interface VersaoResumo {
  numero: number;
  mensagem: string;
  autor: { id: number; nome: string } | null;
  buildId: number | null;
  criadoEm: string;
  totalArquivos: number;
}

interface VersaoDetalhe extends VersaoResumo {
  arquivos: ArquivoTexto[];
}

interface ArquivoAtual {
  caminho: string;
  atualizadoEm: string;
  conteudo?: string;
}

type BaseComparacao = 'anterior' | 'atual';

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado';
}

// "há 5 min", "há 3 h", "há 2 d"; data completa depois de 30 dias.
function dataRelativa(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `há ${dias} d`;
  return formatarData(iso);
}

interface Props {
  projetoId: number;
  aoRestaurar: () => void;
}

export function HistoricoProjeto({ projetoId, aoRestaurar }: Props) {
  const { usuario } = useAuth();
  const podeEscrever = usuario?.perfil !== 'LEITOR';

  const {
    dados: versoes,
    carregando,
    erro,
    recarregar: recarregarVersoes,
  } = useDados<VersaoResumo[]>(`/projetos/${projetoId}/versoes`);
  const { dados: atuais, recarregar: recarregarAtuais } = useDados<ArquivoAtual[]>(
    `/projetos/${projetoId}/arquivos?conteudo=1`,
  );

  const [numeroSel, setNumeroSel] = useState<number | null>(null);
  const [base, setBase] = useState<BaseComparacao>('anterior');
  const [caminhoSel, setCaminhoSel] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = versoes ?? [];
  // Versões vêm do mais recente para o mais antigo: a anterior é o maior número menor que o escolhido.
  const anteriorNumero =
    numeroSel !== null ? (lista.find((v) => v.numero < numeroSel)?.numero ?? null) : null;

  const { dados: versaoSel, carregando: carregandoSel, erro: erroSel } = useDados<VersaoDetalhe>(
    numeroSel !== null ? `/projetos/${projetoId}/versoes/${numeroSel}` : null,
  );
  const { dados: versaoAnterior } = useDados<VersaoDetalhe>(
    base === 'anterior' && anteriorNumero !== null
      ? `/projetos/${projetoId}/versoes/${anteriorNumero}`
      : null,
  );

  // Base da comparação: "anterior" (sem versão anterior = projeto vazio) ou os arquivos atuais.
  let arquivosBase: ArquivoTexto[] | null = null;
  if (base === 'atual') {
    arquivosBase = atuais ? atuais.map((a) => ({ caminho: a.caminho, conteudo: a.conteudo ?? '' })) : null;
  } else if (anteriorNumero === null) {
    arquivosBase = [];
  } else {
    arquivosBase = versaoAnterior?.arquivos ?? null;
  }
  const arquivosSel = versaoSel?.arquivos ?? null;

  const comparados =
    arquivosBase && arquivosSel ? compararArquivos(arquivosBase, arquivosSel) : [];
  const alterados = comparados.filter((c) => c.situacao !== 'igual');

  let blocos: BlocoDiff[] = [];
  if (caminhoSel !== null && arquivosBase && arquivosSel) {
    const conteudoBase = arquivosBase.find((a) => a.caminho === caminhoSel)?.conteudo ?? '';
    const conteudoSel = arquivosSel.find((a) => a.caminho === caminhoSel)?.conteudo ?? '';
    // Verde: linhas que a versão tem e a base não tem. Vermelho: linhas da base que a versão não tem.
    blocos = diffLinhas(conteudoBase, conteudoSel);
  }

  function escolher(numero: number) {
    setNumeroSel(numero);
    setCaminhoSel(null);
    setErroAcao(null);
  }

  async function salvarVersao(e: FormEvent) {
    e.preventDefault();
    const texto = mensagem.trim();
    if (texto === '') return;
    setOcupado(true);
    setErroAcao(null);
    setAviso(null);
    try {
      const nova = await api.post<VersaoResumo>(`/projetos/${projetoId}/versoes`, { mensagem: texto });
      setMensagem('');
      setAviso(`Versão v${nova.numero} salva.`);
      recarregarVersoes();
      escolher(nova.numero);
    } catch (erroSalvar) {
      setErroAcao(mensagemDeErro(erroSalvar));
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(numero: number) {
    const confirmado = window.confirm(
      `Restaurar a v${numero}? Os arquivos atuais serão substituídos. Antes, uma versão automática é salva.`,
    );
    if (!confirmado) return;
    setOcupado(true);
    setErroAcao(null);
    setAviso(null);
    try {
      await api.post(`/projetos/${projetoId}/versoes/${numero}/restaurar`);
      setAviso(`v${numero} restaurada.`);
      recarregarVersoes();
      recarregarAtuais();
      aoRestaurar();
    } catch (erroRestaurar) {
      setErroAcao(mensagemDeErro(erroRestaurar));
    } finally {
      setOcupado(false);
    }
  }

  async function baixarGit() {
    setBaixando(true);
    setErroAcao(null);
    setAviso(null);
    try {
      const token = localStorage.getItem(CHAVE_TOKEN);
      const resposta = await fetch(`/api/projetos/${projetoId}/git.zip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => null)) as { erro?: string } | null;
        throw new Error(dados?.erro ?? 'Falha ao baixar o repositório Git');
      }
      const nome =
        /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1] ??
        'projeto-git.zip';
      const url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (erroBaixar) {
      setErroAcao(mensagemDeErro(erroBaixar));
    } finally {
      setBaixando(false);
    }
  }

  if (carregando && versoes === null) return <Carregando />;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;

  return (
    <div className="historico">
      <div className="historico-coluna">
        {podeEscrever && (
          <form className="historico-salvar" onSubmit={salvarVersao}>
            <Campo
              rotulo="Salvar versão (mensagem)"
              valor={mensagem}
              aoMudar={setMensagem}
              obrigatorio
            />
            <Botao tipo="submit" desabilitado={ocupado || mensagem.trim() === ''}>
              {ocupado ? 'Salvando...' : 'Salvar versão'}
            </Botao>
          </form>
        )}

        <Botao variante="secundario" aoClicar={baixarGit} desabilitado={baixando || lista.length === 0}>
          {baixando ? 'Preparando...' : 'Baixar repositório Git'}
        </Botao>

        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

        {lista.length === 0 ? (
          <p className="historico-vazio">Nenhuma versão salva ainda.</p>
        ) : (
          <ul className="historico-lista">
            {lista.map((v) => (
              <li key={v.numero}>
                <button
                  type="button"
                  className={`historico-item${v.numero === numeroSel ? ' historico-item-ativo' : ''}`}
                  onClick={() => escolher(v.numero)}
                >
                  <span className="historico-titulo">
                    <strong>v{v.numero}</strong> {v.mensagem}
                  </span>
                  <span className="historico-meta">
                    {v.autor?.nome ?? 'Automática'} · {dataRelativa(v.criadoEm)} · {v.totalArquivos}{' '}
                    arquivo(s)
                  </span>
                  {v.buildId !== null && <Selo cor="azul">build #{v.buildId}</Selo>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="historico-detalhe">
        {numeroSel === null ? (
          <p className="historico-vazio">Escolha uma versão para ver as alterações.</p>
        ) : carregandoSel ? (
          <Carregando />
        ) : erroSel ? (
          <Aviso tipo="erro">{erroSel}</Aviso>
        ) : versaoSel ? (
          <>
            <header className="historico-cabecalho-detalhe">
              <div>
                <h3>
                  v{versaoSel.numero}: {versaoSel.mensagem}
                </h3>
                <span className="historico-meta">
                  {versaoSel.autor?.nome ?? 'Automática'} · {formatarData(versaoSel.criadoEm)}
                </span>
              </div>
              {podeEscrever && (
                <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => restaurar(versaoSel.numero)}>
                  Restaurar esta versão
                </Botao>
              )}
            </header>

            <Selecao
              rotulo="Comparar com"
              valor={base}
              aoMudar={(valor) => {
                setBase(valor as BaseComparacao);
                setCaminhoSel(null);
              }}
              opcoes={[
                { valor: 'anterior', rotulo: 'Versão anterior' },
                { valor: 'atual', rotulo: 'Arquivos atuais' },
              ]}
            />

            {base === 'anterior' && anteriorNumero === null && (
              <p className="historico-meta">Primeira versão: comparada com o projeto vazio.</p>
            )}

            {arquivosBase === null || arquivosSel === null ? (
              <Carregando />
            ) : alterados.length === 0 ? (
              <p className="historico-vazio">Nenhum arquivo alterado.</p>
            ) : (
              <ul className="historico-arquivos">
                {alterados.map((c) => (
                  <li key={c.caminho}>
                    <button
                      type="button"
                      className={`historico-arquivo${c.caminho === caminhoSel ? ' historico-item-ativo' : ''}`}
                      onClick={() => setCaminhoSel(c.caminho)}
                    >
                      <span>{c.caminho}</span>
                      <Selo cor={c.situacao === 'removido' ? 'vermelho' : c.situacao === 'adicionado' ? 'verde' : 'amarelo'}>
                        {c.situacao}
                      </Selo>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {arquivosBase && arquivosSel && comparados.length > alterados.length && (
              <p className="historico-meta">{comparados.length - alterados.length} arquivo(s) iguais.</p>
            )}

            {caminhoSel !== null && (
              <div className="historico-diff" aria-label={`Diferenças em ${caminhoSel}`}>
                {blocos.map((bloco, indice) =>
                  bloco.ocultas !== undefined ? (
                    <div key={indice} className="historico-lacuna">
                      ⋯ {bloco.ocultas} linha(s) iguais
                    </div>
                  ) : (
                    bloco.linhas.map((linha, j) => (
                      <div key={`${indice}-${j}`} className={`historico-linha historico-${bloco.tipo}`}>
                        <span className="historico-sinal">
                          {bloco.tipo === 'mais' ? '+' : bloco.tipo === 'menos' ? '-' : ' '}
                        </span>
                        <span className="historico-texto">{linha || ' '}</span>
                      </div>
                    ))
                  ),
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
