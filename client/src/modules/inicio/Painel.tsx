import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { corStatus, rotuloStatus } from '../../lib/tipos-api';
import type { AgenteResumo, PainelRecente, PainelResposta } from '../../lib/tipos-api';
import { useDados } from '../../lib/useDados';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { PontoGrafico } from '../../layout/GraficoLinha';
import { Aviso, Carregando, Selo, formatarDataHora } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import './painel.css';

// ---------- Indicadores e atalhos ----------

type CorCartao = 'azul' | 'roxo' | 'verde' | 'laranja';

interface Indicador {
  chave: string;
  rotulo: string;
  valor: number;
  icone: NomeIcone;
  cor: CorCartao;
}

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  caminho: string;
}

const ATALHOS: Atalho[] = [
  { rotulo: 'Novo agente LLM', icone: 'robo', caminho: '/app/agentes/novo?tipo=LLM' },
  { rotulo: 'Novo agente TinyML', icone: 'cerebro', caminho: '/app/agentes/novo?tipo=TINYML' },
  { rotulo: 'Novo projeto', icone: 'pasta', caminho: '/app/projetos' },
  { rotulo: 'Datasets', icone: 'dados', caminho: '/app/datasets' },
  { rotulo: 'Compilações', icone: 'martelo', caminho: '/app/builds' },
  { rotulo: 'Dispositivos', icone: 'chip', caminho: '/app/dispositivos' },
  { rotulo: 'Integrações', icone: 'plugin', caminho: '/app/integracoes' },
  { rotulo: 'Tokens', icone: 'chave', caminho: '/app/tokens' },
];

// ---------- Formatação ----------

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function dataPorExtenso(d: Date): string {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function horaCurta(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "2026-11-05" -> "05/11"
function diaCurto(iso: string): string {
  const partes = iso.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : iso;
}

function primeiroNomeDe(nome: string | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? '';
}

// A resposta de /painel não traz o id do agente do treino: TREINO leva à tela TinyML.
function caminhoDoRecente(r: PainelRecente): string {
  return r.tipo === 'BUILD' ? '/app/builds' : '/app/tinyml';
}

// ---------- Tela inicial ----------

export function Painel() {
  const { usuario } = useAuth();
  const painel = useDados<PainelResposta>('/painel');
  const [agora, setAgora] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const dados = painel.dados;
  const primeiroNome = primeiroNomeDe(usuario?.nome);
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';

  const indicadores: Indicador[] = dados
    ? [
        { chave: 'llm', rotulo: 'Agentes LLM', valor: dados.contagens.agentesLlm, icone: 'robo', cor: 'azul' },
        { chave: 'tinyml', rotulo: 'Agentes TinyML', valor: dados.contagens.agentesTinyml, icone: 'cerebro', cor: 'roxo' },
        { chave: 'projetos', rotulo: 'Projetos', valor: dados.contagens.projetos, icone: 'pasta', cor: 'verde' },
        { chave: 'dispositivos', rotulo: 'Dispositivos', valor: dados.contagens.dispositivos, icone: 'chip', cor: 'laranja' },
      ]
    : [];

  const pontos: PontoGrafico[] = dados
    ? dados.buildsPorDia.map((d) => ({ rotulo: diaCurto(d.dia), valor: d.sucesso }))
    : [];
  const temCompilacao = pontos.some((p) => p.valor !== null && p.valor > 0);

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <div className="painel-boas-vindas">
          <h1 className="painel-saudacao">{saudacao}</h1>
          <p className="painel-subtitulo">Aqui está o resumo da sua plataforma de IA.</p>
          <span className="painel-traco" aria-hidden="true" />
        </div>
        <div className="painel-relogio">
          <p className="painel-data">
            <Icone nome="calendario" tamanho={18} />
            <span>{dataPorExtenso(agora)}</span>
          </p>
          <p className="painel-hora">{horaCurta(agora)}</p>
        </div>
      </div>

      {painel.carregando && <Carregando />}
      {painel.erro && <Aviso tipo="erro">{painel.erro}</Aviso>}

      {dados && (
        <div className="painel-indicadores">
          {indicadores.map((c) => (
            <article key={c.chave} className="painel-indicador">
              <div className={'painel-indicador-icone painel-cor-' + c.cor}>
                <Icone nome={c.icone} tamanho={26} />
              </div>
              <div className="painel-indicador-texto">
                <span className="painel-indicador-valor">{c.valor}</span>
                <span className="painel-indicador-rotulo">{c.rotulo}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="painel-linha">
        <section className="painel-cartao painel-desempenho">
          <header className="painel-cartao-cabecalho">
            <Icone nome="martelo" tamanho={20} className="painel-cartao-icone" />
            <h2 className="painel-cartao-titulo">Compilações (14 dias)</h2>
          </header>
          {dados &&
            (temCompilacao ? (
              <div className="painel-grafico-corpo">
                <GraficoLinha pontos={pontos} />
              </div>
            ) : (
              <p className="painel-vazio">Nenhuma compilação com sucesso nos últimos 14 dias.</p>
            ))}
        </section>

        <section className="painel-cartao painel-avisos">
          <header className="painel-cartao-cabecalho">
            <Icone nome="atividade" tamanho={20} className="painel-cartao-icone" />
            <h2 className="painel-cartao-titulo">Atividade recente</h2>
            <Link className="painel-ver-todos" to="/app/builds">
              Ver compilações
              <Icone nome="seta-direita" tamanho={14} />
            </Link>
          </header>
          {dados && dados.recentes.length === 0 && <p className="painel-vazio">Nenhuma atividade ainda.</p>}
          {dados && dados.recentes.length > 0 && (
            <ul className="painel-avisos-lista">
              {dados.recentes.map((r) => (
                <li key={r.tipo + '-' + r.id} className="painel-aviso">
                  <Link to={caminhoDoRecente(r)} className="painel-aviso-texto">
                    <span className="painel-aviso-titulo">{r.titulo}</span>
                    <span className="painel-aviso-corpo">
                      {(r.tipo === 'BUILD' ? 'Compilação' : 'Treino') + ' · ' + formatarDataHora(r.criadoEm)}
                    </span>
                  </Link>
                  <Selo cor={corStatus(r.status)}>{rotuloStatus(r.status)}</Selo>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="painel-coluna">
          {dados?.destaque && <Destaque agente={dados.destaque} />}

          <section className="painel-cartao painel-atalhos">
            <header className="painel-cartao-cabecalho">
              <Icone nome="raio" tamanho={18} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Atalhos rápidos</h2>
            </header>
            <div className="painel-atalhos-grade">
              {ATALHOS.map((a) => (
                <Link key={a.rotulo} to={a.caminho} className="painel-atalho">
                  <Icone nome={a.icone} tamanho={22} />
                  <span>{a.rotulo}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function Destaque({ agente }: { agente: AgenteResumo }) {
  return (
    <section className="painel-cartao painel-destaque">
      <div className="painel-destaque-texto">
        <span className="painel-destaque-etiqueta">
          <Icone nome={agente.tipo === 'TINYML' ? 'cerebro' : 'robo'} tamanho={18} />
          Agente em destaque
        </span>
        <h2 className="painel-destaque-titulo">{agente.nome}</h2>
        <p className="painel-destaque-subtitulo">{agente.descricao || agente.modelo || 'Sem descrição'}</p>
        <Link className="painel-pilula" to={'/app/agentes/' + agente.id}>
          Abrir
          <Icone nome="seta-direita" tamanho={14} />
        </Link>
      </div>
    </section>
  );
}
