import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { PrecosLlm, ResumoUso } from '../../lib/tipos-melhorias';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { PontoGrafico } from '../../layout/GraficoLinha';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { mensagemErro } from '../tinyml/componentes';
import './uso.css';

// Tela "Uso e custos" (rota /app/uso, registrada pelo A08). Custos em dólar (USD).
// Preços por 1M tokens: padrão da plataforma, com personalização só para ADMIN.

const PERIODOS = [7, 30, 90] as const;

// Resposta de GET /uso/precos.
interface PrecosResposta {
  padrao: PrecosLlm;
  personalizados: PrecosLlm;
}

// Linha do editor: textos dos campos (vazio = usar o padrão).
type RascunhoPrecos = Record<string, { entrada: string; saida: string }>;

const formatadorUsd = (casas: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: casas,
  });

function formatarUsd(valor: number, casas = 4): string {
  return formatadorUsd(casas).format(valor);
}

function formatarInteiro(valor: number): string {
  return valor.toLocaleString('pt-BR');
}

// "2024-05-03" -> "03/05" (rótulo do eixo do gráfico).
function rotuloDia(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

function montarRascunho(precos: PrecosResposta, modelosUsados: string[]): RascunhoPrecos {
  const nomes = new Set([...Object.keys(precos.padrao), ...Object.keys(precos.personalizados), ...modelosUsados]);
  const rascunho: RascunhoPrecos = {};
  for (const nome of [...nomes].sort()) {
    const personalizado = precos.personalizados[nome];
    rascunho[nome] = {
      entrada: personalizado ? String(personalizado.entrada) : '',
      saida: personalizado ? String(personalizado.saida) : '',
    };
  }
  return rascunho;
}

// Converte o rascunho em preços personalizados. Linha com só um campo preenchido é erro.
function lerPrecos(rascunho: RascunhoPrecos): PrecosLlm {
  const precos: PrecosLlm = {};
  for (const [nome, linha] of Object.entries(rascunho)) {
    const vazioEntrada = linha.entrada.trim() === '';
    const vazioSaida = linha.saida.trim() === '';
    if (vazioEntrada && vazioSaida) continue;
    if (vazioEntrada || vazioSaida) {
      throw new Error(`Preencha entrada e saída de "${nome}" ou deixe as duas vazias (usa o padrão).`);
    }
    const entrada = Number(linha.entrada.replace(',', '.'));
    const saida = Number(linha.saida.replace(',', '.'));
    if (!Number.isFinite(entrada) || !Number.isFinite(saida) || entrada < 0 || saida < 0) {
      throw new Error(`Preço inválido para "${nome}": use números maiores ou iguais a zero.`);
    }
    precos[nome] = { entrada, saida };
  }
  return precos;
}

const COLUNAS_AGENTE: ColunaTabela<ResumoUso['porAgente'][number]>[] = [
  { titulo: 'Agente', celula: (a) => a.nome },
  { titulo: 'Execuções', celula: (a) => formatarInteiro(a.execucoes), alinhar: 'direita' },
  { titulo: 'Entrada', celula: (a) => formatarInteiro(a.entrada), alinhar: 'direita' },
  { titulo: 'Saída', celula: (a) => formatarInteiro(a.saida), alinhar: 'direita' },
  { titulo: 'Custo', celula: (a) => formatarUsd(a.custoUsd), alinhar: 'direita' },
];

const COLUNAS_MODELO: ColunaTabela<ResumoUso['porModelo'][number]>[] = [
  {
    titulo: 'Modelo',
    celula: (m) => (
      <span className="uso-modelo">
        {m.modelo} <Selo cor="cinza">{m.provedor}</Selo>
      </span>
    ),
  },
  { titulo: 'Execuções', celula: (m) => formatarInteiro(m.execucoes), alinhar: 'direita' },
  { titulo: 'Entrada', celula: (m) => formatarInteiro(m.entrada), alinhar: 'direita' },
  { titulo: 'Saída', celula: (m) => formatarInteiro(m.saida), alinhar: 'direita' },
  {
    titulo: 'Custo',
    celula: (m) => (m.custoUsd === null ? <Selo cor="amarelo">sem preço</Selo> : formatarUsd(m.custoUsd)),
    alinhar: 'direita',
  },
];

// Editor de preços (só ADMIN). Carrega os preços e salva os personalizados.
function EditorPrecos({ modelosUsados, aoSalvar }: { modelosUsados: string[]; aoSalvar: () => void }) {
  const precos = useDados<PrecosResposta>('/uso/precos');
  const [rascunho, setRascunho] = useState<RascunhoPrecos>({});
  const [novoModelo, setNovoModelo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    if (precos.dados) setRascunho(montarRascunho(precos.dados, modelosUsados));
    // Só ao carregar os preços; edições locais não são sobrescritas pelo uso.
  }, [precos.dados]);

  function alterar(nome: string, campo: 'entrada' | 'saida', valor: string) {
    setRascunho((atual) => ({ ...atual, [nome]: { ...atual[nome], [campo]: valor } }));
  }

  function adicionar() {
    const nome = novoModelo.trim();
    if (!nome) return;
    if (rascunho[nome]) {
      setErro(`"${nome}" já está na lista.`);
      return;
    }
    setRascunho((atual) => ({ ...atual, [nome]: { entrada: '', saida: '' } }));
    setNovoModelo('');
    setErro(null);
  }

  async function salvar(precosParaSalvar: PrecosLlm) {
    setErro(null);
    setMensagem(null);
    setSalvando(true);
    try {
      await api.put<PrecosResposta>('/uso/precos', { precos: precosParaSalvar });
      setMensagem('Preços salvos.');
      precos.recarregar();
      aoSalvar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  function salvarEditados() {
    let precosLidos: PrecosLlm;
    try {
      precosLidos = lerPrecos(rascunho);
    } catch (e) {
      setErro(mensagemErro(e));
      return;
    }
    void salvar(precosLidos);
  }

  if (precos.carregando && !precos.dados) return <Carregando />;
  if (precos.erro) return <Aviso tipo="erro">{precos.erro}</Aviso>;
  if (!precos.dados) return null;

  const padrao = precos.dados.padrao;
  const nomes = Object.keys(rascunho);

  return (
    <Cartao titulo="Preços por modelo (US$ por 1M tokens)">
      <div className="uso-precos">
        <p className="uso-ajuda">
          Deixe os campos vazios para usar o preço padrão. Preços preenchidos valem para os próximos custos calculados.
        </p>

        {nomes.length === 0 && <p className="uso-ajuda">Nenhum modelo com preço cadastrado.</p>}

        {nomes.map((nome) => {
          const linha = rascunho[nome];
          const base = padrao[nome];
          return (
            <div key={nome} className="uso-preco-linha">
              <div className="uso-preco-modelo">
                <strong>{nome}</strong>
                <span className="uso-ajuda">
                  {base ? `padrão: entrada ${base.entrada} / saída ${base.saida}` : 'sem preço padrão (custo desconhecido)'}
                </span>
              </div>
              <Campo rotulo="Entrada" tipo="number" valor={linha.entrada} aoMudar={(v) => alterar(nome, 'entrada', v)} />
              <Campo rotulo="Saída" tipo="number" valor={linha.saida} aoMudar={(v) => alterar(nome, 'saida', v)} />
            </div>
          );
        })}

        <div className="uso-preco-linha uso-preco-novo">
          <Campo rotulo="Adicionar modelo (nome exato)" valor={novoModelo} aoMudar={setNovoModelo} />
          <Botao variante="secundario" aoClicar={adicionar} desabilitado={novoModelo.trim() === ''}>
            Adicionar
          </Botao>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {mensagem && <Aviso tipo="sucesso">{mensagem}</Aviso>}

        <div className="uso-acoes">
          <Botao aoClicar={salvarEditados} desabilitado={salvando}>
            {salvando ? 'Salvando...' : 'Salvar preços'}
          </Botao>
          <Botao variante="texto" aoClicar={() => void salvar({})} desabilitado={salvando}>
            Voltar tudo ao padrão
          </Botao>
        </div>
      </div>
    </Cartao>
  );
}

export function Uso() {
  const { usuario } = useAuth();
  const admin = usuario?.perfil === 'ADMIN';
  const [dias, setDias] = useState<number>(30);
  const resumo = useDados<ResumoUso>(`/uso/resumo?dias=${dias}`);
  const dados = resumo.dados;

  const pontos: PontoGrafico[] = dados
    ? dados.porDia.map((d) => ({ rotulo: rotuloDia(d.dia), valor: d.custoUsd }))
    : [];
  const maiorCusto = dados ? Math.max(0, ...dados.porDia.map((d) => d.custoUsd)) : 0;
  const modelosUsados = dados ? dados.porModelo.map((m) => m.modelo) : [];

  const acoes = (
    <div className="uso-periodo">
      {PERIODOS.map((p) => (
        <Botao key={p} variante={dias === p ? 'primario' : 'secundario'} aoClicar={() => setDias(p)}>
          {p} dias
        </Botao>
      ))}
    </div>
  );

  return (
    <Pagina titulo="Uso e custos" acoes={acoes}>
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="uso-cartoes">
            <div className="uso-cartao">
              <span className="uso-cartao-rotulo">Custo total</span>
              <strong className="uso-cartao-valor">{formatarUsd(dados.totalUsd)}</strong>
            </div>
            <div className="uso-cartao">
              <span className="uso-cartao-rotulo">Execuções</span>
              <strong className="uso-cartao-valor">{formatarInteiro(dados.execucoes)}</strong>
            </div>
            <div className="uso-cartao">
              <span className="uso-cartao-rotulo">Tokens de entrada</span>
              <strong className="uso-cartao-valor">{formatarInteiro(dados.entrada)}</strong>
            </div>
            <div className="uso-cartao">
              <span className="uso-cartao-rotulo">Tokens de saída</span>
              <strong className="uso-cartao-valor">{formatarInteiro(dados.saida)}</strong>
            </div>
            <div className="uso-cartao">
              <span className="uso-cartao-rotulo">Execuções sem preço</span>
              <strong className="uso-cartao-valor">{formatarInteiro(dados.semPreco)}</strong>
            </div>
          </div>

          {dados.semPreco > 0 && (
            <Aviso tipo="info">
              {dados.semPreco} execução(ões) não têm preço cadastrado para o modelo, então não entram no custo total.
              {admin ? ' Cadastre o preço na seção abaixo.' : ''}
            </Aviso>
          )}

          <Cartao titulo="Custo por dia">
            <div className="uso-grafico">
              <GraficoLinha pontos={pontos} maximo={maiorCusto > 0 ? maiorCusto : 1} formatar={(v) => formatarUsd(v, 2)} />
            </div>
          </Cartao>

          <Cartao titulo="Por agente">
            <Tabela
              colunas={COLUNAS_AGENTE}
              dados={dados.porAgente}
              chave={(a) => a.agenteId ?? 0}
              vazio="Nenhum uso no período."
            />
          </Cartao>

          <Cartao titulo="Por modelo">
            <Tabela
              colunas={COLUNAS_MODELO}
              dados={dados.porModelo}
              chave={(m) => `${m.provedor}|${m.modelo}`}
              vazio="Nenhum uso no período."
            />
          </Cartao>

          {admin && <EditorPrecos modelosUsados={modelosUsados} aoSalvar={() => resumo.recarregar()} />}
        </>
      )}
    </Pagina>
  );
}
