import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { CONFIG_TINYML_PADRAO } from '../../lib/tipos-api';
import type { Agente, ConfigTinyml, ProjetoResumo, TipoAgente } from '../../lib/tipos-api';
import { Abas, AreaTexto, Aviso, Botao, Campo, Carregando, Pagina, Selecao } from '../../ui';
import { AbaTreino, FormularioTinyml } from '../tinyml/componentes';
import { FormularioLlm } from './FormularioLlm';
import type { CamposLlm } from './FormularioLlm';
import { Playground } from './Playground';
import { Versoes } from './Versoes';
import { Exportar } from './ImportarExportar';

interface Campos {
  tipo: TipoAgente;
  nome: string;
  descricao: string;
  tags: string;
  projetoId: string;
  llm: CamposLlm;
  tinyml: ConfigTinyml;
}

// Corpo enviado a POST /agentes e PUT /agentes/:id (AgenteEntrada, CONTRATOS §3).
function montarCorpo(c: Campos): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    nome: c.nome.trim(),
    descricao: c.descricao.trim(),
    tipo: c.tipo,
    tags: c.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
  if (c.projetoId) corpo.projetoId = Number(c.projetoId);

  if (c.tipo === 'TINYML') {
    corpo.configTinyml = c.tinyml;
    return corpo;
  }

  const l = c.llm;
  corpo.provedor = l.provedor;
  if (l.modelo.trim()) corpo.modelo = l.modelo.trim();
  corpo.promptSistema = l.promptSistema;
  // Anthropic usa esforço; OpenAI e Ollama usam temperatura.
  if (l.provedor === 'ANTHROPIC') corpo.esforco = l.esforco;
  else if (l.temperatura !== null) corpo.temperatura = l.temperatura;
  if (l.maxTokens !== null) corpo.maxTokens = l.maxTokens;
  corpo.ferramentas = l.ferramentas;
  return corpo;
}

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// ---------- Tela (carrega o agente e decide novo ou edição) ----------

export function Editor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { usuario } = useAuth();
  const novo = id === undefined;
  const { dados, carregando, erro, recarregar } = useDados<Agente>(novo ? null : `/agentes/${id}`);
  const [aviso, setAviso] = useState<string | null>(null);

  const podeEscrever = usuario?.perfil !== 'LEITOR';
  const tipoNovo: TipoAgente = params.get('tipo') === 'TINYML' ? 'TINYML' : 'LLM';
  const agente = novo ? null : dados;

  if (!novo && carregando && !dados) {
    return (
      <Pagina titulo="Agente">
        <Carregando />
      </Pagina>
    );
  }
  if (!novo && erro) {
    return (
      <Pagina titulo="Agente">
        <Aviso tipo="erro">{erro}</Aviso>
      </Pagina>
    );
  }
  if (!novo && !dados) return null;

  return (
    <EditorCarregado
      key={agente ? `${agente.id}-${agente.versao}` : 'novo'}
      agente={agente}
      tipoNovo={tipoNovo}
      podeEscrever={podeEscrever}
      abaInicial={params.get('aba') ?? 'configuracao'}
      aviso={aviso}
      aoSalvar={(mensagem) => {
        setAviso(mensagem);
        recarregar();
      }}
      aoMudarAba={(aba) =>
        setParams(
          (anterior) => {
            const proximo = new URLSearchParams(anterior);
            proximo.set('aba', aba);
            return proximo;
          },
          { replace: true },
        )
      }
    />
  );
}

// ---------- Formulário (com o agente já carregado) ----------

interface PropsEditorCarregado {
  agente: Agente | null;
  tipoNovo: TipoAgente;
  podeEscrever: boolean;
  abaInicial: string;
  aviso: string | null;
  aoSalvar: (mensagem: string) => void;
  aoMudarAba: (aba: string) => void;
}

function EditorCarregado({
  agente,
  tipoNovo,
  podeEscrever,
  abaInicial,
  aviso,
  aoSalvar,
  aoMudarAba,
}: PropsEditorCarregado) {
  const navegar = useNavigate();
  const tipo: TipoAgente = agente?.tipo ?? tipoNovo;
  const ehLlm = tipo === 'LLM';

  const [nome, setNome] = useState(agente?.nome ?? '');
  const [descricao, setDescricao] = useState(agente?.descricao ?? '');
  const [tags, setTags] = useState((agente?.tags ?? []).join(', '));
  const [projetoId, setProjetoId] = useState(agente?.projetoId ? String(agente.projetoId) : '');
  const [llm, setLlm] = useState<CamposLlm>({
    provedor: agente?.provedor ?? 'ANTHROPIC',
    modelo: agente?.modelo ?? '',
    esforco: agente?.esforco ?? 'high',
    temperatura: agente?.temperatura ?? null,
    maxTokens: agente?.maxTokens ?? null,
    promptSistema: agente?.promptSistema ?? '',
    ferramentas: agente?.ferramentas ?? [],
  });
  const [tinyml, setTinyml] = useState<ConfigTinyml>(agente?.configTinyml ?? CONFIG_TINYML_PADRAO);
  const [nota, setNota] = useState('');
  const [aba, setAba] = useState(abaInicial);
  const [ocupado, setOcupado] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const projetos = useDados<ProjetoResumo[]>('/projetos');

  const campos: Campos = { tipo, nome, descricao, tags, projetoId, llm, tinyml };
  // Foto da configuração salva: comparando com ela, sabe-se se há alterações não salvas.
  const [base] = useState(() => JSON.stringify(montarCorpo(campos)));
  const alteracoes = JSON.stringify(montarCorpo(campos)) !== base;

  const abas = ehLlm
    ? [
        { id: 'configuracao', rotulo: 'Configuração' },
        { id: 'playground', rotulo: 'Playground' },
        { id: 'versoes', rotulo: 'Versões' },
        { id: 'exportar', rotulo: 'Exportar' },
      ]
    : [
        { id: 'configuracao', rotulo: 'Configuração' },
        { id: 'treino', rotulo: 'Treino' },
        { id: 'versoes', rotulo: 'Versões' },
        { id: 'exportar', rotulo: 'Exportar (JSON)' },
      ];
  const abaAtiva = abas.some((a) => a.id === aba) ? aba : 'configuracao';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErroSalvar(null);
    setOcupado(true);
    try {
      if (agente) {
        const corpo = montarCorpo(campos);
        if (nota.trim()) corpo.nota = nota.trim();
        await api.put<Agente>(`/agentes/${agente.id}`, corpo);
        aoSalvar('Alterações salvas.');
      } else {
        const criado = await api.post<Agente>('/agentes', montarCorpo(campos));
        navegar(`/app/agentes/${criado.id}`, { replace: true });
      }
    } catch (err) {
      setErroSalvar(mensagemErro(err));
      setOcupado(false);
    }
  }

  const titulo = agente ? agente.nome : ehLlm ? 'Novo agente LLM' : 'Novo agente TinyML';

  return (
    <Pagina
      titulo={titulo}
      acoes={
        <Botao
          variante="secundario"
          aoClicar={() => navegar(ehLlm ? '/app/agentes' : '/app/tinyml')}
        >
          Voltar à lista
        </Botao>
      }
    >
      <form className="agentes-editor" onSubmit={salvar}>
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

        <Abas
          abas={abas}
          ativa={abaAtiva}
          aoMudar={(id) => {
            setAba(id);
            aoMudarAba(id);
          }}
        />

        <div className="agentes-abas-conteudo">
          {abaAtiva === 'configuracao' && (
            <fieldset disabled={!podeEscrever} className="agentes-campos">
              <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
              <AreaTexto rotulo="Descrição" valor={descricao} aoMudar={setDescricao} linhas={2} />
              <Campo rotulo="Tags (separadas por vírgula)" valor={tags} aoMudar={setTags} />
              <Selecao
                rotulo="Projeto vinculado"
                valor={projetoId}
                aoMudar={setProjetoId}
                opcoes={(projetos.dados ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
                vazio="Nenhum"
              />

              {ehLlm ? (
                <FormularioLlm valor={llm} aoMudar={setLlm} />
              ) : (
                <FormularioTinyml
                  valor={tinyml}
                  aoMudar={setTinyml}
                  somenteLeitura={!podeEscrever}
                />
              )}
            </fieldset>
          )}

          {abaAtiva !== 'configuracao' && !agente && (
            <Aviso tipo="info">Salve o agente antes de usar esta aba.</Aviso>
          )}

          {agente && abaAtiva === 'playground' && ehLlm && (
            podeEscrever ? (
              <Playground agenteId={agente.id} pendente={alteracoes} />
            ) : (
              <Aviso tipo="info">Seu perfil não pode executar agentes.</Aviso>
            )
          )}

          {agente && abaAtiva === 'treino' && !ehLlm && (
            podeEscrever ? (
              <AbaTreino agenteId={agente.id} config={tinyml} />
            ) : (
              <Aviso tipo="info">Seu perfil não pode treinar modelos.</Aviso>
            )
          )}

          {agente && abaAtiva === 'versoes' && (
            <Versoes
              agenteId={agente.id}
              podeEscrever={podeEscrever}
              aoRestaurar={(versao) => aoSalvar(`Versão ${versao} restaurada.`)}
            />
          )}

          {agente && abaAtiva === 'exportar' && <Exportar agente={agente} />}
        </div>

        {podeEscrever && (
          <footer className="agentes-rodape">
            {erroSalvar && <Aviso tipo="erro">{erroSalvar}</Aviso>}
            <div className="agentes-rodape-campos">
              {agente && (
                <Campo rotulo="Nota da versão" valor={nota} aoMudar={setNota} />
              )}
              <Botao tipo="submit" desabilitado={ocupado}>
                Salvar
              </Botao>
            </div>
          </footer>
        )}
      </form>
    </Pagina>
  );
}
