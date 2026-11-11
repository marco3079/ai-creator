import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { ROTULO_TAREFA, TIPOS_MODELO } from '../../lib/tipos-modelos';
import type { ModeloResumo, TipoModelo } from '../../lib/tipos-modelos';
import { rotuloStatus, corStatus } from '../../lib/tipos-api';
import { Abas, Aviso, Botao, Campo, Carregando, Modal, MenuAcoes, Pagina, Selo } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import { atualizadoHa, formatarMetrica, iconeTipo, rotuloTipo } from './comum';

const ABAS = [
  { id: 'TODOS', rotulo: 'Todos' },
  { id: 'TINYML', rotulo: 'TinyML' },
  { id: 'TABULAR', rotulo: 'Clássicos' },
  { id: 'LLM_NUVEM', rotulo: 'LLM nuvem' },
  { id: 'LLM_LOCAL', rotulo: 'LLM local' },
];

function CartaoModelo({ modelo, acoes }: { modelo: ModeloResumo; acoes: AcaoMenu[] }) {
  const { ultimoTreino, publicado } = modelo;
  return (
    <article className="modelo-cartao">
      <header className="modelo-cartao-cabecalho">
        <span className={`modelo-cartao-icone modelo-tipo-${modelo.tipo.toLowerCase()}`}>
          <Icone nome={iconeTipo(modelo.tipo)} tamanho={22} />
        </span>
        <div className="modelo-cartao-titulo">
          <h2 className="modelo-cartao-nome">
            <Link to={`/app/modelos/${modelo.id}`}>{modelo.nome}</Link>
          </h2>
          <span className="modelo-cartao-tipo">{rotuloTipo(modelo.tipo)}</span>
        </div>
        <MenuAcoes rotulo={'Ações de ' + modelo.nome} acoes={acoes} />
      </header>

      <p className="modelo-cartao-descricao">{modelo.descricao || 'Sem descrição.'}</p>

      <dl className="modelo-cartao-dados">
        <div>
          <dt>Tarefa</dt>
          <dd>{ROTULO_TAREFA[modelo.tarefa]}</dd>
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>{modelo.dataset ? modelo.dataset.nome : 'Sem dataset'}</dd>
        </div>
      </dl>

      <div className="modelo-cartao-selos">
        {ultimoTreino ? (
          <Selo cor={corStatus(ultimoTreino.status)}>
            Treino {ultimoTreino.numero}: {rotuloStatus(ultimoTreino.status)}
          </Selo>
        ) : (
          <Selo cor="cinza">Sem treinos</Selo>
        )}
        {publicado && (
          <Selo cor="verde">
            v{publicado.numero} publicada
            {publicado.principal ? ` · ${formatarMetrica(publicado.principal)}` : ''}
          </Selo>
        )}
      </div>

      <footer className="modelo-cartao-rodape">
        <span>
          {modelo.totalTreinos} {modelo.totalTreinos === 1 ? 'treino' : 'treinos'}
        </span>
        <span>{atualizadoHa(modelo.atualizadoEm)}</span>
      </footer>
    </article>
  );
}

export function Lista() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const podeEscrever = usuario?.perfil !== 'LEITOR';

  const [tipo, setTipo] = useState<'TODOS' | TipoModelo>('TODOS');
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [excluindo, setExcluindo] = useState<ModeloResumo | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Busca com atraso de 300 ms para não disparar uma requisição a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const parametros: string[] = [];
  if (tipo !== 'TODOS') parametros.push(`tipo=${tipo}`);
  if (buscaAtiva) parametros.push(`busca=${encodeURIComponent(buscaAtiva)}`);
  const caminho = '/modelos' + (parametros.length ? `?${parametros.join('&')}` : '');
  const { dados, carregando, erro, recarregar } = useDados<ModeloResumo[]>(caminho);

  function novo(tipoInicial?: TipoModelo) {
    navegar(tipoInicial ? `/app/modelos/novo?tipo=${tipoInicial}` : '/app/modelos/novo');
  }

  async function duplicar(m: ModeloResumo) {
    setErroAcao(null);
    setAviso(null);
    try {
      await api.post(`/modelos/${m.id}/duplicar`);
      setAviso(`Modelo "${m.nome}" duplicado.`);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Erro inesperado');
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setErroAcao(null);
    try {
      await api.del(`/modelos/${excluindo.id}`);
      setExcluindo(null);
      setAviso(`Modelo "${excluindo.nome}" excluído.`);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Erro inesperado');
    }
  }

  function acoesDo(m: ModeloResumo): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Abrir', icone: 'lapis', aoClicar: () => navegar(`/app/modelos/${m.id}`) },
    ];
    if (podeEscrever) {
      acoes.push({ rotulo: 'Duplicar', icone: 'copiar', aoClicar: () => duplicar(m) });
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => setExcluindo(m) });
    }
    return acoes;
  }

  const semFiltro = tipo === 'TODOS' && !buscaAtiva;

  return (
    <Pagina
      titulo="Modelos"
      acoes={
        podeEscrever ? (
          <Botao aoClicar={() => novo()}>Novo modelo</Botao>
        ) : undefined
      }
    >
      <p className="modelos-subtitulo">
        Crie e treine modelos de IA: TinyML para placas, clássicos, e ajuste fino de LLMs.
      </p>

      <Abas abas={ABAS} ativa={tipo} aoMudar={(id) => setTipo(id as 'TODOS' | TipoModelo)} />

      <Campo rotulo="Buscar por nome, descrição ou tag" valor={busca} aoMudar={setBusca} />

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && <Carregando />}

      {dados && dados.length === 0 && (
        <div className="modelos-vazio">
          {!semFiltro ? (
            <p>Nenhum modelo encontrado para este filtro.</p>
          ) : (
            <>
              <Icone nome="laboratorio" tamanho={56} />
              <p>Nenhum modelo ainda. Escolha por onde começar:</p>
              <div className="modelos-atalhos">
                {TIPOS_MODELO.map((t) => (
                  <button
                    key={t.valor}
                    type="button"
                    className="modelo-atalho"
                    disabled={!podeEscrever}
                    onClick={() => novo(t.valor)}
                  >
                    <span className={`modelo-cartao-icone modelo-tipo-${t.valor.toLowerCase()}`}>
                      <Icone nome={iconeTipo(t.valor)} tamanho={22} />
                    </span>
                    <strong>{t.rotulo}</strong>
                    <span>{t.descricao}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {dados && dados.length > 0 && (
        <div className="modelos-grade">
          {dados.map((m) => (
            <CartaoModelo key={m.id} modelo={m} acoes={acoesDo(m)} />
          ))}
        </div>
      )}

      <Modal
        aberto={excluindo !== null}
        titulo="Excluir modelo"
        aoFechar={() => setExcluindo(null)}
      >
        <p>
          Excluir o modelo <strong>{excluindo?.nome}</strong>, com todos os seus treinos e
          artefatos? Esta ação não pode ser desfeita.
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
