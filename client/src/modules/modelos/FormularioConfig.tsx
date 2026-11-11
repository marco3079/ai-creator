import { useState } from 'react';
import type { ReactNode } from 'react';
import { PLACAS } from '../../lib/tipos-api';
import type {
  ConfigModelo,
  ConfigModeloLlmLocal,
  ConfigModeloLlmNuvem,
  ConfigModeloTabular,
  ConfigModeloTinyml,
  Hiperparametro,
  OpcoesModelos,
  TarefaModelo,
  TipoModelo,
} from '../../lib/tipos-modelos';
import { AreaTexto, Aviso, Caixa, Selecao, Selo } from '../../ui';

// ---------- Campos locais (com limites e ajuda curta) ----------

// Número do campo: vazio ou inválido vira 0 (o servidor valida os limites), como no módulo TinyML.
function numero(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

function CampoNumero({
  rotulo,
  valor,
  aoMudar,
  min,
  max,
  passo = 1,
  ajuda,
}: {
  rotulo: string;
  valor: number;
  aoMudar: (n: number) => void;
  min?: number;
  max?: number;
  passo?: number | 'any';
  ajuda?: string;
}) {
  return (
    <div className="modelos-campo">
      <label className="campo">
        <span className="campo-rotulo">{rotulo}</span>
        <input
          className="campo-controle"
          type="number"
          value={valor}
          min={min}
          max={max}
          step={passo}
          onChange={(e) => aoMudar(numero(e.target.value))}
        />
      </label>
      {ajuda && <small className="modelos-ajuda">{ajuda}</small>}
    </div>
  );
}

function CampoTexto({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  ajuda,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  placeholder?: string;
  ajuda?: string;
}) {
  return (
    <div className="modelos-campo">
      <label className="campo">
        <span className="campo-rotulo">{rotulo}</span>
        <input
          className="campo-controle"
          type="text"
          value={valor}
          placeholder={placeholder}
          onChange={(e) => aoMudar(e.target.value)}
        />
      </label>
      {ajuda && <small className="modelos-ajuda">{ajuda}</small>}
    </div>
  );
}

// Bloco com texto de ajuda abaixo de um controle que não aceita ajuda própria.
function Ajudado({ ajuda, children }: { ajuda?: string; children: ReactNode }) {
  return (
    <div className="modelos-campo">
      {children}
      {ajuda && <small className="modelos-ajuda">{ajuda}</small>}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="formulario-secao">
      <h3 className="formulario-secao-titulo">{titulo}</h3>
      <div className="formulario-grade">{children}</div>
    </section>
  );
}

// Valores padrão de uma lista de hiperparâmetros (usado ao trocar de algoritmo).
function padroesDe(hps: Hiperparametro[]): Record<string, number | string | boolean> {
  return hps.reduce<Record<string, number | string | boolean>>((acc, h) => {
    acc[h.nome] = h.padrao;
    return acc;
  }, {});
}

// ---------- TinyML ----------

function SecaoTinyml({
  tarefa,
  valor,
  aoMudar,
  opcoes,
}: {
  tarefa: TarefaModelo;
  valor: ConfigModeloTinyml;
  aoMudar: (v: ConfigModeloTinyml) => void;
  opcoes: OpcoesModelos;
}) {
  const eImagem = tarefa === 'IMAGEM';
  const arquiteturas = opcoes.tinyml.arquiteturas.filter((a) => a.tarefas.includes(tarefa));

  const atualizar = (parcial: Partial<ConfigModeloTinyml>) => aoMudar({ ...valor, ...parcial });
  const atualizarEntrada = (parcial: Partial<ConfigModeloTinyml['entrada']>) =>
    aoMudar({ ...valor, entrada: { ...valor.entrada, ...parcial } });

  return (
    <>
      <Secao titulo="Entrada">
        {eImagem ? (
          <>
            <CampoNumero
              rotulo="Largura (px)"
              valor={valor.entrada.imagem.largura}
              min={16}
              max={512}
              aoMudar={(n) => atualizarEntrada({ imagem: { ...valor.entrada.imagem, largura: n } })}
              ajuda="As imagens são redimensionadas para este tamanho."
            />
            <CampoNumero
              rotulo="Altura (px)"
              valor={valor.entrada.imagem.altura}
              min={16}
              max={512}
              aoMudar={(n) => atualizarEntrada({ imagem: { ...valor.entrada.imagem, altura: n } })}
            />
            <Selecao
              rotulo="Cores"
              valor={String(valor.entrada.imagem.cores)}
              opcoes={[
                { valor: '1', rotulo: 'Escala de cinza (1 canal)' },
                { valor: '3', rotulo: 'RGB (3 canais)' },
              ]}
              aoMudar={(v) =>
                atualizarEntrada({ imagem: { ...valor.entrada.imagem, cores: Number(v) === 3 ? 3 : 1 } })
              }
            />
          </>
        ) : (
          <>
            <Selecao
              rotulo="Tipo de dado"
              valor={valor.entrada.tipo}
              opcoes={[
                { valor: 'SERIE_TEMPORAL', rotulo: 'Série temporal (sensores)' },
                { valor: 'AUDIO', rotulo: 'Áudio' },
                { valor: 'TABELA', rotulo: 'Tabela' },
              ]}
              aoMudar={(v) => atualizarEntrada({ tipo: v as ConfigModeloTinyml['entrada']['tipo'] })}
            />
            <CampoNumero
              rotulo="Canais"
              valor={valor.entrada.canais}
              min={1}
              max={16}
              aoMudar={(n) => atualizarEntrada({ canais: n })}
              ajuda="Quantidade de colunas de sinal por amostra."
            />
            <CampoNumero
              rotulo="Janela (amostras)"
              valor={valor.entrada.janela}
              min={1}
              max={1000}
              aoMudar={(n) => atualizarEntrada({ janela: n })}
              ajuda="Quantas amostras consecutivas formam uma entrada da rede."
            />
            <CampoNumero
              rotulo="Frequência (Hz)"
              valor={valor.entrada.frequenciaHz}
              min={1}
              max={10000}
              aoMudar={(n) => atualizarEntrada({ frequenciaHz: n })}
            />
          </>
        )}
      </Secao>

      <Secao titulo="Arquitetura">
        <Selecao
          rotulo="Arquitetura"
          valor={valor.arquitetura}
          opcoes={arquiteturas.map((a) => ({ valor: a.valor, rotulo: a.rotulo }))}
          aoMudar={(v) => atualizar({ arquitetura: v as ConfigModeloTinyml['arquitetura'] })}
        />
        <CampoNumero
          rotulo="Camadas"
          valor={valor.camadas}
          min={1}
          max={6}
          aoMudar={(n) => atualizar({ camadas: n })}
        />
        <CampoNumero
          rotulo="Neurônios por camada"
          valor={valor.neuronios}
          min={4}
          max={256}
          aoMudar={(n) => atualizar({ neuronios: n })}
          ajuda="Quanto maior, mais memória o modelo ocupa na placa."
        />
      </Secao>

      <Secao titulo="Treino">
        <CampoNumero
          rotulo="Épocas"
          valor={valor.epocas}
          min={1}
          max={500}
          aoMudar={(n) => atualizar({ epocas: n })}
        />
        <CampoNumero
          rotulo="Taxa de aprendizado"
          valor={valor.taxaAprendizado}
          min={0}
          passo="any"
          aoMudar={(n) => atualizar({ taxaAprendizado: n })}
          ajuda="Ex.: 0,001."
        />
        <CampoNumero
          rotulo="Tamanho do lote"
          valor={valor.tamanhoLote}
          min={8}
          max={256}
          aoMudar={(n) => atualizar({ tamanhoLote: n })}
        />
        {eImagem && (
          <Ajudado ajuda="Cria variações das imagens (espelho e leve rotação) só no treino.">
            <Caixa
              rotulo="Aumento de dados"
              marcado={valor.aumentoDados}
              aoMudar={(m) => atualizar({ aumentoDados: m })}
            />
          </Ajudado>
        )}
      </Secao>

      <Secao titulo="Placa e exportação">
        <Selecao
          rotulo="Placa-alvo"
          valor={valor.placaAlvo}
          opcoes={PLACAS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
          aoMudar={(v) => atualizar({ placaAlvo: v as ConfigModeloTinyml['placaAlvo'] })}
        />
        <Selecao
          rotulo="Quantização"
          valor={valor.quantizacao}
          opcoes={[
            { valor: 'INT8', rotulo: 'INT8 (menor e mais rápido)' },
            { valor: 'FLOAT32', rotulo: 'FLOAT32 (sem quantização)' },
          ]}
          aoMudar={(v) => atualizar({ quantizacao: v as ConfigModeloTinyml['quantizacao'] })}
        />
        <CampoNumero
          rotulo="Limite de RAM (KB)"
          valor={valor.limiteRamKb}
          min={1}
          aoMudar={(n) => atualizar({ limiteRamKb: n })}
          ajuda="Alerta no log do treino se o modelo ultrapassar."
        />
        <CampoNumero
          rotulo="Limite de flash (KB)"
          valor={valor.limiteFlashKb}
          min={1}
          aoMudar={(n) => atualizar({ limiteFlashKb: n })}
          ajuda="Alerta no log do treino se o modelo ultrapassar."
        />
      </Secao>
    </>
  );
}

// ---------- Clássico (tabular) ----------

function CampoHiperparametro({
  hp,
  valor,
  aoMudar,
}: {
  hp: Hiperparametro;
  valor: number | string | boolean;
  aoMudar: (v: number | string | boolean) => void;
}) {
  if (hp.tipo === 'booleano') {
    return (
      <Ajudado ajuda={hp.ajuda}>
        <Caixa rotulo={hp.rotulo} marcado={Boolean(valor)} aoMudar={(m) => aoMudar(m)} />
      </Ajudado>
    );
  }
  if (hp.tipo === 'opcao') {
    return (
      <Ajudado ajuda={hp.ajuda}>
        <Selecao
          rotulo={hp.rotulo}
          valor={String(valor)}
          opcoes={(hp.opcoes ?? []).map((o) => ({ valor: o, rotulo: o }))}
          aoMudar={(v) => aoMudar(v)}
        />
      </Ajudado>
    );
  }
  if (hp.tipo === 'texto') {
    return <CampoTexto rotulo={hp.rotulo} valor={String(valor)} aoMudar={aoMudar} ajuda={hp.ajuda} />;
  }
  return (
    <CampoNumero
      rotulo={hp.rotulo}
      valor={Number(valor)}
      min={hp.min}
      max={hp.max}
      passo={hp.tipo === 'inteiro' ? 1 : 'any'}
      ajuda={hp.ajuda}
      aoMudar={aoMudar}
    />
  );
}

function SecaoTabular({
  tarefa,
  valor,
  aoMudar,
  opcoes,
}: {
  tarefa: TarefaModelo;
  valor: ConfigModeloTabular;
  aoMudar: (v: ConfigModeloTabular) => void;
  opcoes: OpcoesModelos;
}) {
  const algoritmos = opcoes.tabular.algoritmos.filter((a) => a.tarefas.includes(tarefa));
  const atual = opcoes.tabular.algoritmos.find((a) => a.valor === valor.algoritmo);

  // Ao trocar de algoritmo, os hiperparâmetros voltam aos padrões dele.
  function trocarAlgoritmo(v: string) {
    const novo = opcoes.tabular.algoritmos.find((a) => a.valor === v);
    if (!novo) return;
    aoMudar({
      ...valor,
      algoritmo: novo.valor,
      hiperparametros: padroesDe(novo.hiperparametros),
      exportarC: novo.exportaC ? valor.exportarC : false,
    });
  }

  return (
    <>
      <Secao titulo="Algoritmo">
        <div className="modelos-campo">
          <Selecao
            rotulo="Algoritmo"
            valor={valor.algoritmo}
            opcoes={algoritmos.map((a) => ({ valor: a.valor, rotulo: a.rotulo }))}
            aoMudar={trocarAlgoritmo}
          />
          {atual && (
            <div className="formulario-selos">
              <Selo cor={atual.exportaC ? 'verde' : 'cinza'}>
                {atual.exportaC ? 'exporta C' : 'não exporta C'}
              </Selo>
            </div>
          )}
          {valor.algoritmo === 'SVM' && (
            <small className="modelos-ajuda">Só o kernel linear exporta código C.</small>
          )}
        </div>
      </Secao>

      {atual && atual.hiperparametros.length > 0 && (
        <Secao titulo="Hiperparâmetros">
          {atual.hiperparametros.map((hp) => (
            <CampoHiperparametro
              key={`${atual.valor}-${hp.nome}`}
              hp={hp}
              valor={valor.hiperparametros[hp.nome] ?? hp.padrao}
              aoMudar={(v) =>
                aoMudar({ ...valor, hiperparametros: { ...valor.hiperparametros, [hp.nome]: v } })
              }
            />
          ))}
        </Secao>
      )}

      <Secao titulo="Dados e validação">
        <CampoNumero
          rotulo="Fração de teste"
          valor={valor.testeFracao}
          min={0.1}
          max={0.5}
          passo="any"
          aoMudar={(n) => aoMudar({ ...valor, testeFracao: n })}
          ajuda="Parte dos dados guardada para teste (0,1 a 0,5)."
        />
        <CampoNumero
          rotulo="Validação cruzada (k-fold)"
          valor={valor.validacaoCruzada}
          min={0}
          max={10}
          aoMudar={(n) => aoMudar({ ...valor, validacaoCruzada: n })}
          ajuda="0 desliga. De 2 a 10 dobras."
        />
        <Ajudado ajuda="Padroniza as entradas antes do treino.">
          <Caixa
            rotulo="Normalizar"
            marcado={valor.normalizar}
            aoMudar={(m) => aoMudar({ ...valor, normalizar: m })}
          />
        </Ajudado>
        <Ajudado
          ajuda={
            atual?.exportaC
              ? 'Gera o header modelo_tabular.h para a placa.'
              : 'Este algoritmo não gera código C.'
          }
        >
          <label className="caixa">
            <input
              type="checkbox"
              checked={valor.exportarC}
              disabled={!atual?.exportaC}
              onChange={(e) => aoMudar({ ...valor, exportarC: e.target.checked })}
            />
            <span>Exportar código C</span>
          </label>
        </Ajudado>
      </Secao>
    </>
  );
}

// ---------- LLM na nuvem ----------

const OUTRO_MODELO = '__outro__';

// Campo numérico que pode ficar em "Automático" (valor null, decidido pelo servidor/OpenAI).
function CampoAutomatico({
  rotulo,
  valor,
  padraoManual,
  min,
  max,
  passo,
  aoMudar,
  ajuda,
}: {
  rotulo: string;
  valor: number | null;
  padraoManual: number;
  min: number;
  max: number;
  passo: number | 'any';
  aoMudar: (v: number | null) => void;
  ajuda?: string;
}) {
  const automatico = valor === null;
  return (
    <div className="modelos-campo">
      <Caixa
        rotulo={`${rotulo}: automático`}
        marcado={automatico}
        aoMudar={(m) => aoMudar(m ? null : padraoManual)}
      />
      {valor !== null && (
        <CampoNumero rotulo={rotulo} valor={valor} min={min} max={max} passo={passo} aoMudar={aoMudar} />
      )}
      {ajuda && <small className="modelos-ajuda">{ajuda}</small>}
    </div>
  );
}

function SecaoLlmNuvem({
  valor,
  aoMudar,
  opcoes,
}: {
  valor: ConfigModeloLlmNuvem;
  aoMudar: (v: ConfigModeloLlmNuvem) => void;
  opcoes: OpcoesModelos;
}) {
  const base = opcoes.llmNuvem.modelosBase;
  const [outro, setOutro] = useState(!base.includes(valor.modeloBase));

  return (
    <>
      <Secao titulo="Modelo base">
        <div className="modelos-campo">
          <Selecao
            rotulo="Modelo base"
            valor={outro ? OUTRO_MODELO : valor.modeloBase}
            opcoes={[
              ...base.map((m) => ({ valor: m, rotulo: m })),
              { valor: OUTRO_MODELO, rotulo: 'Outro…' },
            ]}
            aoMudar={(v) => {
              if (v === OUTRO_MODELO) {
                setOutro(true);
                return;
              }
              setOutro(false);
              aoMudar({ ...valor, modeloBase: v });
            }}
          />
        </div>
        {outro && (
          <CampoTexto
            rotulo="Nome do modelo"
            valor={valor.modeloBase}
            aoMudar={(v) => aoMudar({ ...valor, modeloBase: v })}
            ajuda="Digite o identificador exato do modelo na OpenAI."
          />
        )}
      </Secao>

      <Secao titulo="Treino">
        <CampoAutomatico
          rotulo="Épocas"
          valor={valor.epocas}
          padraoManual={3}
          min={1}
          max={50}
          passo={1}
          aoMudar={(v) => aoMudar({ ...valor, epocas: v })}
        />
        <CampoAutomatico
          rotulo="Tamanho do lote"
          valor={valor.tamanhoLote}
          padraoManual={2}
          min={1}
          max={256}
          passo={1}
          aoMudar={(v) => aoMudar({ ...valor, tamanhoLote: v })}
        />
        <CampoAutomatico
          rotulo="Multiplicador da taxa"
          valor={valor.multiplicadorTaxa}
          padraoManual={1}
          min={0.02}
          max={2}
          passo="any"
          aoMudar={(v) => aoMudar({ ...valor, multiplicadorTaxa: v })}
          ajuda="Ajusta a taxa de aprendizado que a OpenAI escolhe."
        />
        <CampoTexto
          rotulo="Sufixo"
          valor={valor.sufixo}
          aoMudar={(v) =>
            aoMudar({ ...valor, sufixo: v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18) })
          }
          ajuda="Até 18 caracteres: letras minúsculas, números e hífen. Entra no nome do modelo treinado."
        />
      </Secao>

      <Secao titulo="Agente">
        <Ajudado ajuda="Usado ao criar um agente com o modelo treinado.">
          <AreaTexto
            rotulo="Prompt de sistema"
            valor={valor.promptSistema}
            aoMudar={(v) => aoMudar({ ...valor, promptSistema: v })}
            linhas={4}
          />
        </Ajudado>
      </Secao>

      <Aviso tipo="info">O ajuste fino é cobrado pela OpenAI por token treinado.</Aviso>
    </>
  );
}

// ---------- LLM local (LoRA) ----------

function SecaoLlmLocal({
  valor,
  aoMudar,
  opcoes,
}: {
  valor: ConfigModeloLlmLocal;
  aoMudar: (v: ConfigModeloLlmLocal) => void;
  opcoes: OpcoesModelos;
}) {
  const atualizar = (parcial: Partial<ConfigModeloLlmLocal>) => aoMudar({ ...valor, ...parcial });
  const { llmLocal } = opcoes;

  return (
    <>
      <Secao titulo="Modelo base">
        <Selecao
          rotulo="Modelo base"
          valor={valor.modeloBase}
          opcoes={llmLocal.modelosBase.map((m) => ({ valor: m, rotulo: m }))}
          aoMudar={(v) => atualizar({ modeloBase: v as ConfigModeloLlmLocal['modeloBase'] })}
        />
      </Secao>

      <Secao titulo="Adaptador LoRA">
        <CampoNumero
          rotulo="Rank (r)"
          valor={valor.loraRank}
          min={4}
          max={64}
          aoMudar={(n) => atualizar({ loraRank: n })}
          ajuda="Tamanho do adaptador. Mais alto = mais parâmetros treinados."
        />
        <CampoNumero
          rotulo="Alpha"
          valor={valor.loraAlpha}
          min={8}
          max={128}
          aoMudar={(n) => atualizar({ loraAlpha: n })}
          ajuda="Escala do adaptador. Costuma ser o dobro do rank."
        />
      </Secao>

      <Secao titulo="Treino">
        <CampoNumero
          rotulo="Épocas"
          valor={valor.epocas}
          min={1}
          max={10}
          aoMudar={(n) => atualizar({ epocas: n })}
        />
        <CampoNumero
          rotulo="Taxa de aprendizado"
          valor={valor.taxaAprendizado}
          min={0}
          passo="any"
          aoMudar={(n) => atualizar({ taxaAprendizado: n })}
          ajuda="Ex.: 0,0002."
        />
        <CampoNumero
          rotulo="Tamanho do lote"
          valor={valor.tamanhoLote}
          min={1}
          max={16}
          aoMudar={(n) => atualizar({ tamanhoLote: n })}
        />
        <CampoNumero
          rotulo="Comprimento máximo (tokens)"
          valor={valor.comprimentoMax}
          min={256}
          max={4096}
          aoMudar={(n) => atualizar({ comprimentoMax: n })}
          ajuda="Conversas maiores que isso são cortadas no treino."
        />
      </Secao>

      <Secao titulo="Registro e agente">
        <CampoTexto
          rotulo="Nome no Ollama"
          valor={valor.nomeOllama}
          placeholder="aic-<slug>-v<n>"
          aoMudar={(v) => atualizar({ nomeOllama: v })}
          ajuda="Vazio = nome automático. Letras minúsculas, números e hífen."
        />
        <Ajudado ajuda="Usado ao criar um agente com o modelo treinado.">
          <AreaTexto
            rotulo="Prompt de sistema"
            valor={valor.promptSistema}
            aoMudar={(v) => atualizar({ promptSistema: v })}
            linhas={4}
          />
        </Ajudado>
      </Secao>

      <Aviso tipo="info">
        {!llmLocal.disponivel
          ? 'Serviço finetuner offline. O treino local só roda com ele ativo (perfil gpu do Docker).'
          : llmLocal.gpu
            ? `Treino local usa a GPU (${llmLocal.dispositivo}).`
            : 'Sem GPU no finetuner: o treino local precisa de GPU NVIDIA e pode não rodar.'}
      </Aviso>
    </>
  );
}

// ---------- Formulário ----------

export function FormularioConfigModelo({
  tipo,
  tarefa,
  valor,
  aoMudar,
  opcoes,
  somenteLeitura,
}: {
  tipo: TipoModelo;
  tarefa: TarefaModelo;
  valor: ConfigModelo;
  aoMudar: (v: ConfigModelo) => void;
  opcoes: OpcoesModelos;
  somenteLeitura?: boolean;
}) {
  // fieldset desabilitado desabilita todos os controles de dentro (modo leitura).
  return (
    <fieldset className="formulario-config" disabled={somenteLeitura}>
      {tipo === 'TINYML' && (
        <SecaoTinyml
          tarefa={tarefa}
          valor={valor as ConfigModeloTinyml}
          aoMudar={aoMudar}
          opcoes={opcoes}
        />
      )}
      {tipo === 'TABULAR' && (
        <SecaoTabular
          tarefa={tarefa}
          valor={valor as ConfigModeloTabular}
          aoMudar={aoMudar}
          opcoes={opcoes}
        />
      )}
      {tipo === 'LLM_NUVEM' && (
        <SecaoLlmNuvem valor={valor as ConfigModeloLlmNuvem} aoMudar={aoMudar} opcoes={opcoes} />
      )}
      {tipo === 'LLM_LOCAL' && (
        <SecaoLlmLocal valor={valor as ConfigModeloLlmLocal} aoMudar={aoMudar} opcoes={opcoes} />
      )}
    </fieldset>
  );
}
