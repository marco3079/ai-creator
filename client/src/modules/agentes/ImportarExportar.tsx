import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../../lib/api';
import type { Agente } from '../../lib/tipos-api';
import { Aviso, Botao, Modal, Selecao } from '../../ui';

type Formato = 'md' | 'json';

// A exportação devolve texto puro (não JSON), então não passa pelo api.get.
const CHAVE_TOKEN = 'aicreator.token';

async function baixarTexto(caminho: string): Promise<string> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(CHAVE_TOKEN);
  } catch {
    token = null;
  }
  const resposta = await fetch('/api' + caminho, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resposta.ok) {
    let mensagem = 'Erro inesperado';
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados?.erro) mensagem = dados.erro;
    } catch {
      // Sem JSON no corpo: fica a mensagem padrão.
    }
    throw new Error(mensagem);
  }
  return resposta.text();
}

// ---------- Exportar (aba do editor) ----------

export function Exportar({ agente }: { agente: Agente }) {
  const ehLlm = agente.tipo === 'LLM';
  const [formato, setFormato] = useState<Formato>(ehLlm ? 'md' : 'json');
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setTexto(null);
    setErro(null);
    baixarTexto(`/agentes/${agente.id}/exportar?formato=${formato}`)
      .then((t) => {
        if (!cancelado) setTexto(t);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Erro inesperado');
      });
    return () => {
      cancelado = true;
    };
  }, [agente.id, formato]);

  async function copiar() {
    if (texto === null) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  function baixar() {
    if (texto === null) return;
    const blob = new Blob([texto], {
      type: formato === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agente.slug}.${formato}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="agentes-exportar">
      <div className="agentes-exportar-barra">
        {ehLlm ? (
          <Selecao
            rotulo="Formato"
            valor={formato}
            aoMudar={(v) => setFormato(v as Formato)}
            opcoes={[
              { valor: 'md', rotulo: 'Markdown (subagente do Claude Code)' },
              { valor: 'json', rotulo: 'JSON' },
            ]}
          />
        ) : (
          <p className="agentes-ajuda">Formato: JSON</p>
        )}
        <div className="pagina-acoes">
          <Botao variante="secundario" desabilitado={texto === null} aoClicar={copiar}>
            {copiado ? 'Copiado' : 'Copiar'}
          </Botao>
          <Botao desabilitado={texto === null} aoClicar={baixar}>
            Baixar {agente.slug}.{formato}
          </Botao>
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {texto !== null && <pre className="agentes-pre">{texto}</pre>}
    </div>
  );
}

// ---------- Importar (modal da lista) ----------

export function ImportarModal({
  aberto,
  aoFechar,
  aoImportado,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoImportado: (agente: Agente) => void;
}) {
  const [conteudo, setConteudo] = useState('');
  const [formato, setFormato] = useState<Formato>('md');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      setConteudo(String(leitor.result ?? ''));
      setFormato(arquivo.name.toLowerCase().endsWith('.json') ? 'json' : 'md');
      setNomeArquivo(arquivo.name);
      setErro(null);
    };
    leitor.onerror = () => setErro('Não foi possível ler o arquivo.');
    leitor.readAsText(arquivo);
  }

  async function importar(e: FormEvent) {
    e.preventDefault();
    if (!conteudo.trim()) {
      setErro('Cole o conteúdo ou escolha um arquivo.');
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const agente = await api.post<Agente>('/agentes/importar', { conteudo, formato });
      aoImportado(agente);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro inesperado');
      setOcupado(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Importar agente" aoFechar={aoFechar}>
      <form onSubmit={importar} className="agentes-importar">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <label className="campo">
          <span className="campo-rotulo">Arquivo (.md ou .json)</span>
          <input className="campo-controle" type="file" accept=".md,.json" onChange={escolherArquivo} />
          {nomeArquivo && <span className="agentes-ajuda">Arquivo: {nomeArquivo}</span>}
        </label>

        <label className="campo">
          <span className="campo-rotulo">Ou cole o conteúdo</span>
          <textarea
            className="campo-controle agentes-codigo"
            rows={12}
            value={conteudo}
            onChange={(e) => setConteudo(e.target.value)}
          />
        </label>

        <Selecao
          rotulo="Formato"
          valor={formato}
          aoMudar={(v) => setFormato(v as Formato)}
          opcoes={[
            { valor: 'md', rotulo: 'Markdown (.md)' },
            { valor: 'json', rotulo: 'JSON (.json)' },
          ]}
        />

        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={ocupado}>
            Importar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
