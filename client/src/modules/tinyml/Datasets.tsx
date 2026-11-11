import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { Dataset } from '../../lib/tipos-api';
import type { AmostraDataset } from '../../lib/tipos-modelos';
import {
  Aviso,
  AreaTexto,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { baixarComToken, mensagemErro } from './componentes';

const CHAVE_TOKEN = 'aicreator.token';

const TIPOS: { valor: string; rotulo: string }[] = [
  { valor: 'SERIE_TEMPORAL', rotulo: 'Série temporal (sensores)' },
  { valor: 'AUDIO', rotulo: 'Áudio' },
  { valor: 'TABELA', rotulo: 'Tabela de atributos' },
  { valor: 'IMAGENS', rotulo: 'Imagens (classificação)' },
  { valor: 'CONVERSAS', rotulo: 'Conversas (ajuste de LLM)' },
];

const rotuloTipo = (tipo: string) => TIPOS.find((t) => t.valor === tipo)?.rotulo ?? tipo;

// Tipos que chegam como arquivo (.zip ou .jsonl) em vez de CSV.
const FORMATO_ARQUIVO: Record<string, { extensao: string; ajuda: string }> = {
  IMAGENS: {
    extensao: '.zip',
    ajuda:
      'Um .zip com uma pasta por classe, por exemplo classe_a/foto1.jpg e classe_b/foto2.jpg. Pelo menos 2 classes e 2 imagens por classe. Formatos: jpg, png, bmp e gif.',
  },
  CONVERSAS: {
    extensao: '.jsonl',
    ajuda:
      'Uma conversa por linha, em JSON: {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}. Mínimo de 10 conversas. Cada uma precisa de uma mensagem do usuário e termina com a do assistente.',
  },
};

const EXTENSAO_IMAGEM = /\.(jpe?g|png|bmp|gif)$/i;

const ROTULO_PAPEL: Record<string, string> = { system: 'Sistema', user: 'Usuário', assistant: 'Assistente' };

// Divide o CSV em linhas e colunas para a prévia (sem tratar aspas; o servidor faz a validação completa).
function lerPrevia(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(',').map((c) => c.trim()));
}

// Conta as imagens de um .zip lendo só o diretório central (sem descomprimir). Só para a prévia.
function contarImagensZip(bytes: ArrayBuffer): number {
  const visao = new DataView(bytes);
  const decodificador = new TextDecoder();
  let fim = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (visao.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return 0;
  const total = visao.getUint16(fim + 10, true);
  let posicao = visao.getUint32(fim + 16, true);
  let imagens = 0;
  for (let k = 0; k < total && posicao + 46 <= bytes.byteLength; k++) {
    if (visao.getUint32(posicao, true) !== 0x02014b50) break;
    const tamNome = visao.getUint16(posicao + 28, true);
    const tamExtra = visao.getUint16(posicao + 30, true);
    const tamComentario = visao.getUint16(posicao + 32, true);
    const nome = decodificador.decode(new Uint8Array(bytes, posicao + 46, tamNome));
    const oculto = nome.includes('__MACOSX') || nome.split('/').some((p) => p.startsWith('.'));
    if (EXTENSAO_IMAGEM.test(nome) && !oculto) imagens++;
    posicao += 46 + tamNome + tamExtra + tamComentario;
  }
  return imagens;
}

// ---------- Novo dataset ----------

function FormNovoDataset({ aoConcluir }: { aoConcluir: () => void }) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState('SERIE_TEMPORAL');
  const [janela, setJanela] = useState('50');
  const [csv, setCsv] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previaArquivo, setPreviaArquivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const usaArquivo = tipo in FORMATO_ARQUIVO;

  function trocarTipo(novo: string) {
    setTipo(novo);
    setArquivo(null);
    setNomeArquivo('');
    setPreviaArquivo('');
    setErro(null);
  }

  function lerArquivoCsv(arquivoCsv: File | undefined) {
    if (!arquivoCsv) return;
    setErro(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      setCsv(typeof leitor.result === 'string' ? leitor.result : '');
      setNomeArquivo(arquivoCsv.name);
      if (!nome.trim()) setNome(arquivoCsv.name.replace(/\.csv$/i, ''));
    };
    leitor.onerror = () => setErro('Não foi possível ler o arquivo.');
    leitor.readAsText(arquivoCsv);
  }

  async function escolherArquivo(escolhido: File | undefined) {
    setErro(null);
    setPreviaArquivo('');
    setArquivo(escolhido ?? null);
    setNomeArquivo(escolhido?.name ?? '');
    if (!escolhido) return;
    if (!nome.trim()) setNome(escolhido.name.replace(/\.(zip|jsonl)$/i, ''));
    try {
      if (tipo === 'IMAGENS') {
        const imagens = contarImagensZip(await escolhido.arrayBuffer());
        setPreviaArquivo(`${imagens} imagens encontradas`);
      } else {
        const linhas = (await escolhido.text()).split(/\r?\n/).filter((l) => l.trim().length > 0).length;
        setPreviaArquivo(`${linhas} linhas (conversas)`);
      }
    } catch {
      setPreviaArquivo('');
    }
  }

  const previa = lerPrevia(csv);
  const cabecalho = previa[0] ?? [];
  const linhasPrevia = previa.slice(1, 6);

  async function enviarArquivo() {
    if (!arquivo) {
      setErro(tipo === 'IMAGENS' ? 'Escolha um arquivo .zip.' : 'Escolha um arquivo .jsonl.');
      return;
    }
    setOcupado(true);
    const parametros = new URLSearchParams({ nome: nome.trim(), tipo });
    if (descricao.trim()) parametros.set('descricao', descricao.trim());
    const token = localStorage.getItem(CHAVE_TOKEN);
    try {
      const resposta = await fetch(`/api/datasets/arquivo?${parametros.toString()}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/octet-stream',
        },
        body: arquivo,
      });
      if (!resposta.ok) {
        let mensagem = 'Não foi possível enviar o arquivo.';
        try {
          const dados = (await resposta.json()) as { erro?: string };
          if (dados.erro) mensagem = dados.erro;
        } catch {
          // resposta sem JSON: mantém a mensagem padrão
        }
        throw new Error(mensagem);
      }
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (usaArquivo) {
      await enviarArquivo();
      return;
    }
    if (!csv.trim()) {
      setErro('Escolha um arquivo .csv ou cole o conteúdo.');
      return;
    }
    setOcupado(true);
    try {
      await api.post('/datasets', {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        tipo,
        janela: tipo === 'SERIE_TEMPORAL' ? Number(janela) : undefined,
        csv,
      });
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} />
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={trocarTipo} opcoes={TIPOS} obrigatorio />
      {tipo === 'SERIE_TEMPORAL' && (
        <Campo
          rotulo="Janela (amostras por exemplo)"
          tipo="number"
          valor={janela}
          aoMudar={setJanela}
          obrigatorio
        />
      )}

      {usaArquivo ? (
        <>
          <p className="tinyml-ajuda">{FORMATO_ARQUIVO[tipo].ajuda}</p>
          <label className="campo">
            <span className="campo-rotulo">Arquivo {FORMATO_ARQUIVO[tipo].extensao} *</span>
            <input
              key={tipo}
              type="file"
              accept={FORMATO_ARQUIVO[tipo].extensao}
              disabled={ocupado}
              onChange={(e) => void escolherArquivo(e.target.files?.[0])}
            />
            {nomeArquivo && (
              <span className="tinyml-ajuda">
                Arquivo: {nomeArquivo}
                {previaArquivo && ` · ${previaArquivo}`}
              </span>
            )}
          </label>
          {ocupado && (
            <div className="tinyml-envio">
              <p className="tinyml-ajuda">Enviando…</p>
              <div className="tinyml-barra" role="progressbar" aria-label="Enviando arquivo">
                <span />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="campo">
            <span className="campo-rotulo">Arquivo .csv</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => lerArquivoCsv(e.target.files?.[0])} />
            {nomeArquivo && <span className="tinyml-ajuda">Arquivo: {nomeArquivo}</span>}
          </label>

          <AreaTexto
            rotulo="Ou cole o conteúdo do CSV"
            valor={csv}
            aoMudar={(v) => {
              setCsv(v);
              setNomeArquivo('');
            }}
            linhas={5}
          />

          {previa.length > 0 && (
            <>
              <h3 className="tinyml-subtitulo">Prévia (5 primeiras linhas)</h3>
              <div className="tinyml-matriz-rolagem">
                <table className="tabela">
                  <thead>
                    <tr>
                      {cabecalho.slice(0, 8).map((c, i) => (
                        <th key={i}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasPrevia.map((linha, i) => (
                      <tr key={i}>
                        {linha.slice(0, 8).map((c, j) => (
                          <td key={j}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          {ocupado ? 'Enviando...' : 'Criar dataset'}
        </Botao>
      </div>
    </form>
  );
}

// ---------- Amostra ----------

// Miniatura carregada com o token; a URL de blob é revogada quando a miniatura sai da tela.
function Miniatura({ datasetId, caminho }: { datasetId: number; caminho: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falha, setFalha] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let urlCriada: string | null = null;
    const token = localStorage.getItem(CHAVE_TOKEN);
    fetch(`/api/datasets/${datasetId}/imagem?caminho=${encodeURIComponent(caminho)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error('imagem indisponível');
        return r.blob();
      })
      .then((blob) => {
        if (cancelado) return;
        urlCriada = URL.createObjectURL(blob);
        setUrl(urlCriada);
      })
      .catch(() => {
        if (!cancelado) setFalha(true);
      });
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [datasetId, caminho]);

  return (
    <div className="tinyml-miniatura">
      {url ? (
        <img src={url} alt={caminho.split('/').pop() ?? caminho} loading="lazy" />
      ) : (
        <span className="tinyml-ajuda">{falha ? 'indisponível' : 'carregando…'}</span>
      )}
    </div>
  );
}

function AmostraImagens({
  datasetId,
  classes,
}: {
  datasetId: number;
  classes: { nome: string; quantidade: number; exemplos: string[] }[];
}) {
  return (
    <div className="tinyml-classes">
      {classes.map((c) => (
        <section key={c.nome} className="tinyml-classe">
          <h3 className="tinyml-subtitulo">
            {c.nome} <span className="tinyml-ajuda">· {c.quantidade} imagens</span>
          </h3>
          <div className="tinyml-miniaturas">
            {c.exemplos.map((caminho) => (
              <Miniatura key={caminho} datasetId={datasetId} caminho={caminho} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AmostraConversas({ conversas }: { conversas: { messages: { role: string; content: string }[] }[] }) {
  return (
    <div className="tinyml-conversas">
      {conversas.map((conversa, i) => (
        <article key={i} className="tinyml-conversa">
          <p className="tinyml-ajuda">Conversa {i + 1}</p>
          {conversa.messages.map((m, j) => (
            <div key={j} className={'tinyml-balao tinyml-balao-' + m.role}>
              <span className="tinyml-balao-papel">{ROTULO_PAPEL[m.role] ?? m.role}</span>
              <p>{m.content}</p>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function AmostraTabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: string[][] }) {
  return (
    <div className="tinyml-matriz-rolagem">
      <table className="tabela">
        <thead>
          <tr>
            {cabecalho.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i}>
              {linha.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmostraDatasetModal({ dataset, aoFechar }: { dataset: Dataset; aoFechar: () => void }) {
  const amostra = useDados<AmostraDataset>(`/datasets/${dataset.id}/amostra`);
  const dados = amostra.dados;
  return (
    <Modal aberto titulo={`Amostra: ${dataset.nome}`} aoFechar={aoFechar}>
      {amostra.erro && <Aviso tipo="erro">{amostra.erro}</Aviso>}
      {amostra.carregando && !dados && <Carregando />}
      {dados?.formato === 'IMAGENS' && <AmostraImagens datasetId={dataset.id} classes={dados.classes} />}
      {dados?.formato === 'CONVERSAS' && <AmostraConversas conversas={dados.conversas} />}
      {dados?.formato === 'TABELA' && <AmostraTabela cabecalho={dados.cabecalho} linhas={dados.linhas} />}
    </Modal>
  );
}

// ---------- Tela ----------

export function Datasets() {
  const { dados, carregando, erro, recarregar } = useDados<Dataset[]>('/datasets');
  const [novo, setNovo] = useState(false);
  const [amostraDe, setAmostraDe] = useState<Dataset | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function baixar(d: Dataset) {
    setErroAcao(null);
    try {
      if (d.tipo === 'CONVERSAS') {
        await baixarComToken(`/datasets/${d.id}/arquivo`, `${d.nome}.jsonl`);
      } else {
        await baixarComToken(`/datasets/${d.id}/csv`, `${d.nome}.csv`);
      }
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function excluir(d: Dataset) {
    if (!window.confirm(`Excluir o dataset "${d.nome}"? Os treinos feitos com ele continuam, mas o arquivo some.`)) {
      return;
    }
    setErroAcao(null);
    try {
      await api.del(`/datasets/${d.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const colunas: ColunaTabela<Dataset>[] = [
    {
      titulo: 'Nome',
      celula: (d) => (
        <span>
          <strong>{d.nome}</strong>
          {d.descricao && <span className="tinyml-ajuda"> {d.descricao}</span>}
        </span>
      ),
    },
    { titulo: 'Tipo', celula: (d) => rotuloTipo(d.tipo) },
    {
      titulo: 'Classes',
      celula: (d) =>
        d.classes.length === 0 ? (
          '—'
        ) : (
          <span className="tinyml-chips">
            {d.classes.map((c) => (
              <Selo key={c} cor="azul">
                {c}
              </Selo>
            ))}
          </span>
        ),
    },
    { titulo: 'Amostras', alinhar: 'direita', celula: (d) => d.amostras },
    { titulo: 'Colunas', alinhar: 'direita', celula: (d) => d.colunas },
    { titulo: 'Data', celula: (d) => formatarDataHora(d.criadoEm) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (d) => (
        <span className="tinyml-acoes">
          <Botao variante="texto" aoClicar={() => setAmostraDe(d)}>
            Ver amostra
          </Botao>
          {d.tipo !== 'IMAGENS' && (
            <Botao variante="texto" aoClicar={() => baixar(d)}>
              {d.tipo === 'CONVERSAS' ? 'Baixar JSONL' : 'Baixar CSV'}
            </Botao>
          )}
          <Botao variante="perigo" aoClicar={() => excluir(d)}>
            Excluir
          </Botao>
        </span>
      ),
    },
  ];

  return (
    <Pagina titulo="Datasets" acoes={<Botao aoClicar={() => setNovo(true)}>Novo dataset</Botao>}>
      <Cartao titulo="Formato do CSV">
        <p className="tinyml-ajuda">
          A primeira linha é o cabeçalho <code>rotulo,f0,f1,...,fN</code>. Cada linha seguinte traz o rótulo
          (nome da classe) e N valores numéricos. Para série temporal, a janela vem achatada por amostra, na
          ordem <code>ax0,ay0,az0,ax1,...</code>. Para imagens envie um .zip com uma pasta por classe; para
          conversas (LLM), um .jsonl com uma conversa por linha.
        </p>
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <Tabela<Dataset>
          chave={(d) => d.id}
          dados={dados}
          vazio="Nenhum dataset cadastrado."
          colunas={colunas}
        />
      )}

      <Modal aberto={novo} titulo="Novo dataset" aoFechar={() => setNovo(false)}>
        {novo && (
          <FormNovoDataset
            aoConcluir={() => {
              setNovo(false);
              recarregar();
            }}
          />
        )}
      </Modal>

      {amostraDe && (
        <AmostraDatasetModal key={amostraDe.id} dataset={amostraDe} aoFechar={() => setAmostraDe(null)} />
      )}
    </Pagina>
  );
}
