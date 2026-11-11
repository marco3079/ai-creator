import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { Dataset } from '../../lib/tipos-api';
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

interface AmostraDataset {
  cabecalho: string[];
  linhas: string[][];
}

const TIPOS: { valor: string; rotulo: string }[] = [
  { valor: 'SERIE_TEMPORAL', rotulo: 'Série temporal (sensores)' },
  { valor: 'AUDIO', rotulo: 'Áudio' },
  { valor: 'TABELA', rotulo: 'Tabela de atributos' },
];

const rotuloTipo = (tipo: string) => TIPOS.find((t) => t.valor === tipo)?.rotulo ?? tipo;

// Divide o CSV em linhas e colunas para a prévia (sem tratar aspas; o servidor faz a validação completa).
function lerPrevia(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(',').map((c) => c.trim()));
}

// ---------- Novo dataset ----------

function FormNovoDataset({ aoConcluir }: { aoConcluir: () => void }) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState('SERIE_TEMPORAL');
  const [janela, setJanela] = useState('50');
  const [csv, setCsv] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function lerArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      setCsv(typeof leitor.result === 'string' ? leitor.result : '');
      setNomeArquivo(arquivo.name);
      if (!nome.trim()) setNome(arquivo.name.replace(/\.csv$/i, ''));
    };
    leitor.onerror = () => setErro('Não foi possível ler o arquivo.');
    leitor.readAsText(arquivo);
  }

  const previa = lerPrevia(csv);
  const cabecalho = previa[0] ?? [];
  const linhasPrevia = previa.slice(1, 6);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
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
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS} obrigatorio />
      {tipo === 'SERIE_TEMPORAL' && (
        <Campo
          rotulo="Janela (amostras por exemplo)"
          tipo="number"
          valor={janela}
          aoMudar={setJanela}
          obrigatorio
        />
      )}

      <label className="campo">
        <span className="campo-rotulo">Arquivo .csv</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => lerArquivo(e.target.files?.[0])}
        />
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

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          {ocupado ? 'Enviando...' : 'Criar dataset'}
        </Botao>
      </div>
    </form>
  );
}

// ---------- Amostra ----------

function AmostraDatasetModal({ dataset, aoFechar }: { dataset: Dataset; aoFechar: () => void }) {
  const amostra = useDados<AmostraDataset>(`/datasets/${dataset.id}/amostra`);
  return (
    <Modal aberto titulo={`Amostra: ${dataset.nome}`} aoFechar={aoFechar}>
      {amostra.erro && <Aviso tipo="erro">{amostra.erro}</Aviso>}
      {amostra.carregando && !amostra.dados && <Carregando />}
      {amostra.dados && (
        <div className="tinyml-matriz-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                {amostra.dados.cabecalho.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {amostra.dados.linhas.map((linha, i) => (
                <tr key={i}>
                  {linha.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      await baixarComToken(`/datasets/${d.id}/csv`, `${d.nome}.csv`);
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function excluir(d: Dataset) {
    if (!window.confirm(`Excluir o dataset "${d.nome}"? Os treinos feitos com ele continuam, mas o CSV some.`)) {
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
          <Botao variante="texto" aoClicar={() => baixar(d)}>
            Baixar CSV
          </Botao>
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
          ordem <code>ax0,ay0,az0,ax1,...</code>.
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
