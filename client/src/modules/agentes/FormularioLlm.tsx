import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import type { Provedor } from '../../lib/tipos-api';
import { Campo, Selecao, Selo } from '../../ui';

// Campos de configuração de um agente LLM (formato do formulário, não do contrato da API).
export interface CamposLlm {
  provedor: Provedor;
  modelo: string;
  esforco: string;
  temperatura: number | null;
  maxTokens: number | null;
  promptSistema: string;
  ferramentas: string[];
}

// Ferramentas do Claude Code oferecidas como chips (§3, formato .md de subagente).
export const FERRAMENTAS_PADRAO = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Agent',
];

const PROVEDORES: { valor: Provedor; rotulo: string }[] = [
  { valor: 'ANTHROPIC', rotulo: 'Anthropic (Claude)' },
  { valor: 'OPENAI', rotulo: 'OpenAI' },
  { valor: 'OLLAMA', rotulo: 'Ollama (local)' },
];

const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'];

const OUTRO_MODELO = '__outro__';

interface ModelosDisponiveis {
  ANTHROPIC: string[];
  OPENAI: string[];
  OLLAMA: string[];
}

interface StatusProvedores {
  ANTHROPIC: boolean;
  OPENAI: boolean;
  OLLAMA: boolean;
}

export function FormularioLlm({
  valor,
  aoMudar,
}: {
  valor: CamposLlm;
  aoMudar: (v: CamposLlm) => void;
}) {
  const modelos = useDados<ModelosDisponiveis>('/llm/modelos');
  const status = useDados<StatusProvedores>('/llm/status');
  const [modoOutro, setModoOutro] = useState(false);

  const listaModelos = modelos.dados?.[valor.provedor] ?? [];
  // Campo livre quando o usuário escolheu "Outro…" ou quando o modelo salvo não está na lista do provedor.
  const usaLivre =
    modoOutro ||
    (modelos.dados !== null && valor.modelo !== '' && !listaModelos.includes(valor.modelo));

  const opcoesModelo = [
    ...listaModelos.map((m) => ({ valor: m, rotulo: m })),
    { valor: OUTRO_MODELO, rotulo: 'Outro…' },
  ];

  const chaveOk = status.dados ? status.dados[valor.provedor] : true;
  const ehAnthropic = valor.provedor === 'ANTHROPIC';

  function mudarProvedor(v: string) {
    setModoOutro(false);
    aoMudar({ ...valor, provedor: v as Provedor, modelo: '' });
  }

  function mudarModelo(v: string) {
    if (v === OUTRO_MODELO) {
      setModoOutro(true);
      aoMudar({ ...valor, modelo: '' });
      return;
    }
    setModoOutro(false);
    aoMudar({ ...valor, modelo: v });
  }

  function alternarFerramenta(nome: string) {
    const ativa = valor.ferramentas.includes(nome);
    aoMudar({
      ...valor,
      ferramentas: ativa
        ? valor.ferramentas.filter((f) => f !== nome)
        : [...valor.ferramentas, nome],
    });
  }

  const [ferramentaLivre, setFerramentaLivre] = useState('');

  function adicionarFerramenta() {
    const nome = ferramentaLivre.trim();
    setFerramentaLivre('');
    if (!nome || valor.ferramentas.includes(nome)) return;
    aoMudar({ ...valor, ferramentas: [...valor.ferramentas, nome] });
  }

  const ferramentasExtras = valor.ferramentas.filter((f) => !FERRAMENTAS_PADRAO.includes(f));

  return (
    <div className="agentes-formulario-llm">
      <div className="agentes-linha">
        <div className="agentes-provedor">
          <Selecao
            rotulo="Provedor"
            valor={valor.provedor}
            aoMudar={mudarProvedor}
            opcoes={PROVEDORES}
            vazio="Selecione"
            obrigatorio
          />
          {status.dados && !chaveOk && (
            <Selo cor="amarelo">
              {valor.provedor === 'OLLAMA' ? 'Ollama não respondeu' : 'Chave não configurada'}
            </Selo>
          )}
        </div>

        <div className="agentes-modelo">
          {usaLivre ? (
            <Campo
              rotulo="Modelo (campo livre)"
              valor={valor.modelo}
              aoMudar={(m) => aoMudar({ ...valor, modelo: m })}
            />
          ) : (
            <Selecao
              rotulo="Modelo"
              valor={valor.modelo}
              aoMudar={mudarModelo}
              opcoes={opcoesModelo}
              vazio="Selecione"
            />
          )}
        </div>
      </div>

      <div className="agentes-linha">
        {ehAnthropic ? (
          <Selecao
            rotulo="Esforço"
            valor={valor.esforco}
            aoMudar={(e) => aoMudar({ ...valor, esforco: e })}
            opcoes={ESFORCOS.map((e) => ({ valor: e, rotulo: e }))}
            vazio="Padrão (high)"
          />
        ) : (
          <label className="campo">
            <span className="campo-rotulo">Temperatura (0 a 2)</span>
            <input
              className="campo-controle"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={valor.temperatura ?? ''}
              onChange={(e) =>
                aoMudar({
                  ...valor,
                  temperatura: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
        )}

        <label className="campo">
          <span className="campo-rotulo">Máximo de tokens (opcional)</span>
          <input
            className="campo-controle"
            type="number"
            min={1}
            step={1}
            value={valor.maxTokens ?? ''}
            onChange={(e) =>
              aoMudar({
                ...valor,
                maxTokens: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>

      <label className="campo">
        <span className="campo-rotulo">Prompt de sistema</span>
        <textarea
          className="campo-controle agentes-codigo"
          rows={14}
          value={valor.promptSistema}
          onChange={(e) => aoMudar({ ...valor, promptSistema: e.target.value })}
        />
        <span className="agentes-contador">{valor.promptSistema.length} caracteres</span>
      </label>

      <fieldset className="agentes-ferramentas">
        <legend className="campo-rotulo">Ferramentas</legend>
        <div className="agentes-chips">
          {[...FERRAMENTAS_PADRAO, ...ferramentasExtras].map((nome) => {
            const ativa = valor.ferramentas.includes(nome);
            return (
              <button
                key={nome}
                type="button"
                className={ativa ? 'agentes-chip agentes-chip-ativo' : 'agentes-chip'}
                aria-pressed={ativa}
                onClick={() => alternarFerramenta(nome)}
              >
                {nome}
              </button>
            );
          })}
        </div>
        <div className="agentes-adicionar">
          <input
            className="campo-controle"
            type="text"
            aria-label="Outra ferramenta"
            value={ferramentaLivre}
            onChange={(e) => setFerramentaLivre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adicionarFerramenta();
              }
            }}
          />
          <button type="button" className="botao botao-secundario" onClick={adicionarFerramenta}>
            Adicionar
          </button>
        </div>
      </fieldset>
    </div>
  );
}
