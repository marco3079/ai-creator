import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { AgenteResumo, TipoAgente } from '../../lib/tipos-api';
import { Aviso, Botao, Campo, Carregando, Modal, MenuAcoes, Pagina, Selo, formatarData } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import { ImportarModal } from './ImportarExportar';

// "há 3 minutos", "há 2 dias"; a partir de 30 dias mostra a data.
function atualizadoHa(iso: string): string {
  const tempo = new Date(iso).getTime();
  if (Number.isNaN(tempo)) return '';
  const segundos = (Date.now() - tempo) / 1000;
  if (segundos < 60) return 'atualizado agora';
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always' });
  const minutos = segundos / 60;
  const horas = minutos / 60;
  const dias = horas / 24;
  if (minutos < 60) return `atualizado ${rtf.format(-Math.round(minutos), 'minute')}`;
  if (horas < 24) return `atualizado ${rtf.format(-Math.round(horas), 'hour')}`;
  if (dias < 30) return `atualizado ${rtf.format(-Math.round(dias), 'day')}`;
  return `atualizado em ${formatarData(iso)}`;
}

const ROTULO_PROVEDOR: Record<string, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
  OLLAMA: 'Ollama',
};

function CartaoAgente({ agente, acoes }: { agente: AgenteResumo; acoes: AcaoMenu[] }) {
  const ehLlm = agente.tipo === 'LLM';
  return (
    <article className="agente-cartao">
      <header className="agente-cartao-cabecalho">
        <h2 className="agente-cartao-nome">
          <Link to={`/app/agentes/${agente.id}`}>{agente.nome}</Link>
        </h2>
        <MenuAcoes rotulo={'Ações de ' + agente.nome} acoes={acoes} />
      </header>

      <p className="agente-cartao-descricao">{agente.descricao || 'Sem descrição.'}</p>

      <div className="agente-cartao-selos">
        {ehLlm ? (
          <>
            {agente.provedor && <Selo cor="azul">{ROTULO_PROVEDOR[agente.provedor] ?? agente.provedor}</Selo>}
            {agente.modelo && <Selo cor="cinza">{agente.modelo}</Selo>}
          </>
        ) : (
          <Selo cor="verde">TinyML</Selo>
        )}
        {agente.projeto && <Selo cor="cinza">{agente.projeto.nome}</Selo>}
      </div>

      {agente.tags.length > 0 && (
        <ul className="agente-cartao-tags" aria-label="Tags">
          {agente.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <footer className="agente-cartao-rodape">
        <span>v{agente.versao}</span>
        <span>{atualizadoHa(agente.atualizadoEm)}</span>
      </footer>
    </article>
  );
}

export function Lista({ tipo }: { tipo: TipoAgente }) {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const podeEscrever = usuario?.perfil !== 'LEITOR';
  const ehLlm = tipo === 'LLM';

  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [importando, setImportando] = useState(false);
  const [excluindo, setExcluindo] = useState<AgenteResumo | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Busca com atraso de 300 ms para não disparar uma requisição a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const caminho =
    `/agentes?tipo=${tipo}` + (buscaAtiva ? `&busca=${encodeURIComponent(buscaAtiva)}` : '');
  const { dados, carregando, erro, recarregar } = useDados<AgenteResumo[]>(caminho);

  function novo() {
    navegar(`/app/agentes/novo?tipo=${tipo}`);
  }

  async function duplicar(a: AgenteResumo) {
    setErroAcao(null);
    setAviso(null);
    try {
      await api.post(`/agentes/${a.id}/duplicar`);
      setAviso(`Agente "${a.nome}" duplicado.`);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Erro inesperado');
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setErroAcao(null);
    try {
      await api.del(`/agentes/${excluindo.id}`);
      setExcluindo(null);
      setAviso(`Agente "${excluindo.nome}" excluído.`);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Erro inesperado');
    }
  }

  function acoesDo(a: AgenteResumo): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Abrir', icone: 'lapis', aoClicar: () => navegar(`/app/agentes/${a.id}`) },
    ];
    if (podeEscrever) {
      acoes.push({ rotulo: 'Duplicar', icone: 'copiar', aoClicar: () => duplicar(a) });
    }
    if (ehLlm) {
      acoes.push({
        rotulo: 'Exportar .md',
        icone: 'download',
        aoClicar: () => navegar(`/app/agentes/${a.id}?aba=exportar`),
      });
    }
    if (podeEscrever) {
      acoes.push({
        rotulo: 'Excluir',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => setExcluindo(a),
      });
    }
    return acoes;
  }

  const acoesCabecalho = podeEscrever ? (
    <>
      <Botao aoClicar={novo}>Novo agente</Botao>
      {ehLlm && (
        <Botao variante="secundario" aoClicar={() => setImportando(true)}>
          Importar
        </Botao>
      )}
    </>
  ) : undefined;

  return (
    <Pagina titulo={ehLlm ? 'Agentes LLM' : 'Agentes TinyML'} acoes={acoesCabecalho}>
      <Campo rotulo="Buscar por nome, descrição ou tag" valor={busca} aoMudar={setBusca} />

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && <Carregando />}

      {dados && dados.length === 0 && (
        <div className="agentes-vazio">
          <Icone nome={ehLlm ? 'robo' : 'cerebro'} tamanho={56} />
          {buscaAtiva ? (
            <p>Nenhum agente encontrado para essa busca.</p>
          ) : (
            <>
              <p>{ehLlm ? 'Nenhum agente LLM ainda.' : 'Nenhum agente TinyML ainda.'}</p>
              {podeEscrever && <Botao aoClicar={novo}>Criar o primeiro agente</Botao>}
            </>
          )}
        </div>
      )}

      {dados && dados.length > 0 && (
        <div className="agentes-grade">
          {dados.map((a) => (
            <CartaoAgente key={a.id} agente={a} acoes={acoesDo(a)} />
          ))}
        </div>
      )}

      {importando && (
        <ImportarModal
          aberto
          aoFechar={() => setImportando(false)}
          aoImportado={(agente) => navegar(`/app/agentes/${agente.id}`)}
        />
      )}

      <Modal
        aberto={excluindo !== null}
        titulo="Excluir agente"
        aoFechar={() => setExcluindo(null)}
      >
        <p>
          Excluir o agente <strong>{excluindo?.nome}</strong>? Esta ação não pode ser desfeita.
        </p>
        <div className="pagina-acoes">
          <Botao variante="perigo" aoClicar={confirmarExclusao}>
            Excluir
          </Botao>
          <Botao variante="secundario" aoClicar={() => setExcluindo(null)}>
            Cancelar
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
