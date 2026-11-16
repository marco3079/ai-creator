import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Aviso, Botao, Campo, Cartao, Pagina, Selecao, Selo } from '../../ui';
import { api } from '../../lib/api';
import type { MetadadosColeta } from '../../lib/tipos-melhorias';
import { ConexaoSerial, suportaSerial } from './serial';
import { GraficoAoVivo, PONTOS_GRAFICO } from './GraficoAoVivo';
import {
  CANAIS_SIMULADOS,
  GESTOS_SIMULADOS,
  HZ_SIMULADOS,
  METADADO_SIMULADO,
  NOMES_SIMULADOS,
  interpretarMetadado,
  linhaSimulada,
} from './simulador';
import type { GestoSimulado } from './simulador';
import './coleta.css';

// O firmware COLETOR usa 115200 (ver arquivosModelo).
const BAUD_COLETA = 115200;
const JANELA_PADRAO = 50;
const JANELA_MAX = 1000;

type Fonte = 'placa' | 'simulador';

// Um exemplo gravado: `janela` linhas, cada uma com `canais` valores.
interface Exemplo {
  id: number;
  rotulo: string;
  janela: number;
  canais: number;
  linhas: number[][];
}

interface Gravacao {
  rotulo: string;
  janela: number;
  linhas: number[][];
}

/** Dataset criado pela tela (resposta de POST /datasets). */
interface DatasetCriado {
  id: number;
  nome: string;
}

/** Tela de coleta: lê a placa (ou o simulador), grava exemplos rotulados e salva como dataset SERIE_TEMPORAL. */
export function Coleta() {
  const [fonte, setFonte] = useState<Fonte>('simulador');
  const [gesto, setGesto] = useState<GestoSimulado>('parado');
  const [simRodando, setSimRodando] = useState(false);
  const [placaConectada, setPlacaConectada] = useState(false);
  const [meta, setMeta] = useState<MetadadosColeta | null>(null);
  const [pontos, setPontos] = useState<number[][]>([]);
  const [rotulo, setRotulo] = useState('');
  const [janelaTexto, setJanelaTexto] = useState(String(JANELA_PADRAO));
  const [gravando, setGravando] = useState<{ rotulo: string; faltam: number } | null>(null);
  const [exemplos, setExemplos] = useState<Exemplo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [datasetSalvo, setDatasetSalvo] = useState<DatasetCriado | null>(null);

  const conexaoRef = useRef<ConexaoSerial | null>(null);
  const intervaloRef = useRef<number | null>(null);
  const tempoRef = useRef(0);
  const gestoRef = useRef<GestoSimulado>('parado');
  const metaRef = useRef<MetadadosColeta | null>(null);
  const gravacaoRef = useRef<Gravacao | null>(null);
  const pontosPendentes = useRef<number[][]>([]);
  const agendadoPontos = useRef(false);
  const sequenciaExemplo = useRef(0);

  // Uma conexão por tela; a porta é fechada ao sair.
  useEffect(() => {
    const conexao = new ConexaoSerial();
    conexaoRef.current = conexao;
    const pararLinhas = conexao.aoLinha(processarLinha);
    const pararQueda = conexao.aoFecharInesperado(() => {
      setPlacaConectada(false);
      setErro('A placa foi desconectada.');
    });
    return () => {
      pararLinhas();
      pararQueda();
      if (intervaloRef.current !== null) window.clearInterval(intervaloRef.current);
      void conexao.fechar();
    };
    // processarLinha só usa refs e setters estáveis, então a conexão é criada uma vez.
  }, []);

  // Recebe uma linha (da placa ou do simulador). Linhas "#" são metadados; as demais são amostras.
  function processarLinha(linha: string) {
    if (linha.startsWith('#')) {
      const m = interpretarMetadado(linha);
      if (m) {
        metaRef.current = m;
        setMeta(m);
      }
      return;
    }
    if (linha.trim() === '') return;

    const valores = linha.split(',').map(Number);
    const canais = metaRef.current?.canais ?? valores.length;
    if (valores.length !== canais || valores.some((v) => !Number.isFinite(v))) return;

    empurrarPonto(valores);

    const g = gravacaoRef.current;
    if (g) {
      g.linhas.push(valores);
      if (g.linhas.length >= g.janela) {
        gravacaoRef.current = null;
        sequenciaExemplo.current += 1;
        setExemplos((atuais) => [
          ...atuais,
          {
            id: sequenciaExemplo.current,
            rotulo: g.rotulo,
            janela: g.janela,
            canais,
            linhas: g.linhas,
          },
        ]);
        setGravando(null);
      } else {
        const faltam = g.janela - g.linhas.length;
        setGravando({ rotulo: g.rotulo, faltam });
      }
    }
  }

  // Agrupa os pontos do gráfico em um quadro de animação (até ~60 atualizações por segundo).
  function empurrarPonto(valores: number[]) {
    pontosPendentes.current.push(valores);
    if (!agendadoPontos.current) {
      agendadoPontos.current = true;
      requestAnimationFrame(() => {
        agendadoPontos.current = false;
        const novos = pontosPendentes.current;
        pontosPendentes.current = [];
        setPontos((atuais) => [...atuais, ...novos].slice(-PONTOS_GRAFICO));
      });
    }
  }

  function pararSimulador() {
    if (intervaloRef.current !== null) {
      window.clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
    setSimRodando(false);
  }

  function iniciarSimulador() {
    pararSimulador();
    tempoRef.current = 0;
    gestoRef.current = gesto;
    metaRef.current = null;
    setMeta(null);
    processarLinha(METADADO_SIMULADO);
    const passo = 1 / HZ_SIMULADOS;
    intervaloRef.current = window.setInterval(() => {
      processarLinha(linhaSimulada(gestoRef.current, tempoRef.current));
      tempoRef.current += passo;
    }, 1000 / HZ_SIMULADOS);
    setSimRodando(true);
  }

  async function conectarPlaca() {
    const conexao = conexaoRef.current;
    if (!conexao) return;
    setErro(null);
    try {
      metaRef.current = null;
      setMeta(null);
      await conexao.abrir(BAUD_COLETA);
      setPlacaConectada(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a porta.');
    }
  }

  async function desconectarPlaca() {
    await conexaoRef.current?.fechar();
    setPlacaConectada(false);
  }

  function trocarFonte(nova: Fonte) {
    setFonte(nova);
    setErro(null);
    gravacaoRef.current = null;
    setGravando(null);
    metaRef.current = null;
    setMeta(null);
    setPontos([]);
    if (nova === 'simulador') {
      void desconectarPlaca();
    } else {
      pararSimulador();
    }
  }

  function trocarGesto(valor: string) {
    const novo = valor as GestoSimulado;
    setGesto(novo);
    gestoRef.current = novo;
  }

  const fonteAtiva = fonte === 'simulador' ? simRodando : placaConectada;
  const janela = Math.min(JANELA_MAX, Math.max(1, Math.floor(Number(janelaTexto) || 0)));
  const janelaValida = Number.isFinite(janela) && Number(janelaTexto) >= 1;

  function gravarExemplo() {
    const nome = rotulo.trim();
    if (!fonteAtiva || nome === '' || !janelaValida || gravando) return;
    gravacaoRef.current = { rotulo: nome, janela, linhas: [] };
    setGravando({ rotulo: nome, faltam: janela });
    setErro(null);
  }

  function excluirExemplo(id: number) {
    setExemplos((atuais) => atuais.filter((e) => e.id !== id));
    setDatasetSalvo(null);
  }

  const contagem = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const e of exemplos) mapa.set(e.rotulo, (mapa.get(e.rotulo) ?? 0) + 1);
    return [...mapa.entries()];
  }, [exemplos]);

  async function salvarDataset() {
    if (exemplos.length === 0) return;
    const janelaComum = exemplos[0].janela;
    const canaisComum = exemplos[0].canais;
    if (exemplos.some((e) => e.janela !== janelaComum || e.canais !== canaisComum)) {
      setErro('Todos os exemplos precisam ter a mesma janela e o mesmo número de canais.');
      return;
    }

    // Colunas: f0..f(janela*canais-1), canais intercalados por amostra: c0_t0,c1_t0,c2_t0,c0_t1,...
    const colunas = ['rotulo', ...Array.from({ length: janelaComum * canaisComum }, (_, i) => `f${i}`)];
    const linhasCsv = exemplos.map((e) => {
      const valores: number[] = [];
      for (let t = 0; t < janelaComum; t++) {
        for (let c = 0; c < canaisComum; c++) valores.push(e.linhas[t][c]);
      }
      // Vírgula ou quebra de linha no rótulo quebrariam o CSV.
      const rot = e.rotulo.replace(/[,\r\n]/g, ' ');
      return [rot, ...valores.map((v) => String(v))].join(',');
    });
    const csv = [colunas.join(','), ...linhasCsv].join('\n') + '\n';

    setSalvando(true);
    setErro(null);
    try {
      const criado = await api.post<DatasetCriado>('/datasets', {
        nome: `Coleta de sensores ${new Date().toLocaleString('pt-BR')}`,
        tipo: 'SERIE_TEMPORAL',
        janela: janelaComum,
        csv,
      });
      setDatasetSalvo(criado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o dataset.');
    } finally {
      setSalvando(false);
    }
  }

  const nomesCanais = meta?.nomes.length ? meta.nomes : fonte === 'simulador' ? NOMES_SIMULADOS : [];

  return (
    <Pagina titulo="Coletar dados">
      {!suportaSerial() && fonte === 'placa' && (
        <Aviso tipo="info">
          Para ler a placa é preciso a Web Serial API (Chrome ou Edge no computador). Use o simulador ou
          abra esta página nesse navegador.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao titulo="Fonte de dados">
        <div className="coleta-barra">
          <Selecao
            rotulo="Fonte"
            valor={fonte}
            aoMudar={(v) => trocarFonte(v as Fonte)}
            opcoes={[
              { valor: 'placa', rotulo: 'Placa (USB)' },
              { valor: 'simulador', rotulo: 'Simulador (sem placa)' },
            ]}
          />
          {fonte === 'placa' ? (
            placaConectada ? (
              <Botao variante="perigo" aoClicar={desconectarPlaca}>
                Desconectar
              </Botao>
            ) : (
              <Botao aoClicar={conectarPlaca} desabilitado={!suportaSerial()}>
                Conectar placa
              </Botao>
            )
          ) : (
            <>
              <Selecao
                rotulo="Gesto simulado"
                valor={gesto}
                aoMudar={trocarGesto}
                opcoes={GESTOS_SIMULADOS.map((g) => ({ valor: g.valor, rotulo: g.rotulo }))}
              />
              {simRodando ? (
                <Botao variante="secundario" aoClicar={pararSimulador}>
                  Parar simulador
                </Botao>
              ) : (
                <Botao aoClicar={iniciarSimulador}>Iniciar simulador</Botao>
              )}
            </>
          )}
        </div>
        <p className="coleta-meta">
          {meta
            ? `${meta.canais} canais · ${meta.hz} Hz · ${meta.nomes.join(', ')}`
            : fonteAtiva
              ? 'Aguardando os metadados da placa (# AIC-COLETA)...'
              : `Sem dados. Esperado: ${CANAIS_SIMULADOS} canais a ${HZ_SIMULADOS} Hz.`}
        </p>
      </Cartao>

      <Cartao titulo="Sinais ao vivo">
        {pontos.length === 0 ? (
          <p className="coleta-vazio">Nenhum dado ainda. Conecte a placa ou inicie o simulador.</p>
        ) : (
          <GraficoAoVivo nomes={nomesCanais} pontos={pontos} />
        )}
      </Cartao>

      <Cartao titulo="Gravar exemplos">
        <p className="coleta-dica">Dica: grave pelo menos 20 exemplos de cada gesto.</p>
        <div className="coleta-form">
          <Campo rotulo="Rótulo (gesto)" valor={rotulo} aoMudar={setRotulo} obrigatorio />
          <Campo
            rotulo="Amostras por exemplo (janela)"
            valor={janelaTexto}
            aoMudar={setJanelaTexto}
            tipo="number"
          />
          <Botao
            aoClicar={gravarExemplo}
            desabilitado={!fonteAtiva || rotulo.trim() === '' || !janelaValida || gravando !== null}
          >
            Gravar exemplo
          </Botao>
        </div>
        {gravando && (
          <p className="coleta-gravando" role="status">
            Gravando “{gravando.rotulo}”: faltam {gravando.faltam} amostras...
          </p>
        )}
        {contagem.length > 0 && (
          <div className="coleta-contagem">
            {contagem.map(([nome, n]) => (
              <Selo key={nome} cor="azul">
                {nome}: {n}
              </Selo>
            ))}
          </div>
        )}
      </Cartao>

      <Cartao titulo="Exemplos">
        {exemplos.length === 0 ? (
          <p className="coleta-vazio">Nenhum exemplo gravado.</p>
        ) : (
          <ul className="coleta-lista">
            {exemplos.map((e) => (
              <li key={e.id} className="coleta-item">
                <span>
                  <strong>{e.rotulo}</strong> · {e.janela} amostras · {e.canais} canais
                </span>
                <Botao variante="texto" aoClicar={() => excluirExemplo(e.id)}>
                  Excluir
                </Botao>
              </li>
            ))}
          </ul>
        )}

        <div className="coleta-acoes">
          <Botao aoClicar={salvarDataset} desabilitado={exemplos.length === 0 || salvando}>
            {salvando ? 'Salvando...' : 'Salvar como dataset'}
          </Botao>
        </div>
        {datasetSalvo && (
          <Aviso tipo="sucesso">
            Dataset “{datasetSalvo.nome}” salvo. <Link to="/app/datasets">Ver datasets</Link>
          </Aviso>
        )}
      </Cartao>
    </Pagina>
  );
}
