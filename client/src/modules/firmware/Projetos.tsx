import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Aviso, Botao, Carregando, Campo, AreaTexto, Grade, Modal, Pagina, Selecao, Selo, formatarDataHora } from '../../ui';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { PLACAS, rotuloStatus, corStatus } from '../../lib/tipos-api';
import type { Placa, ProjetoResumo } from '../../lib/tipos-api';
import './firmware.css';

function rotuloPlaca(placa: string): string {
  return PLACAS.find((p) => p.valor === placa)?.rotulo ?? placa;
}

export function Projetos() {
  const { dados, carregando, erro } = useDados<ProjetoResumo[]>('/projetos');
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [placa, setPlaca] = useState<Placa>('ESP32');
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const navegar = useNavigate();

  function abrirNovo() {
    setNome('');
    setDescricao('');
    setPlaca('ESP32');
    setErroForm(null);
    setNovo(true);
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErroForm(null);
    try {
      const projeto = await api.post<ProjetoResumo>('/projetos', {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        placa,
      });
      setNovo(false);
      navegar(`/app/projetos/${projeto.id}`);
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Pagina
      titulo="Projetos"
      acoes={<Botao aoClicar={abrirNovo}>Novo projeto</Botao>}
    >
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && dados.length === 0 && (
        <p className="firmware-vazio">Nenhum projeto ainda. Crie o primeiro para começar.</p>
      )}

      {dados && dados.length > 0 && (
        <Grade>
          {dados.map((p) => (
            <Link key={p.id} to={`/app/projetos/${p.id}`} className="firmware-card">
              <div className="firmware-card-topo">
                <h2 className="firmware-card-titulo">{p.nome}</h2>
                <Selo cor="azul">{rotuloPlaca(p.placa)}</Selo>
              </div>
              {p.descricao && <p className="firmware-card-descricao">{p.descricao}</p>}
              <div className="firmware-card-rodape">
                <span className="firmware-meta">
                  {p.totalArquivos} {p.totalArquivos === 1 ? 'arquivo' : 'arquivos'}
                </span>
                {p.ultimoBuild ? (
                  <span className="firmware-meta">
                    <Selo cor={corStatus(p.ultimoBuild.status)}>
                      {rotuloStatus(p.ultimoBuild.status)}
                    </Selo>{' '}
                    {formatarDataHora(p.ultimoBuild.criadoEm)}
                  </span>
                ) : (
                  <span className="firmware-meta">Sem compilações</span>
                )}
              </div>
            </Link>
          ))}
        </Grade>
      )}

      <Modal aberto={novo} titulo="Novo projeto" aoFechar={() => setNovo(false)}>
        <form className="firmware-form" onSubmit={criar}>
          <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
          <AreaTexto rotulo="Descrição" valor={descricao} aoMudar={setDescricao} linhas={3} />
          <Selecao
            rotulo="Placa"
            valor={placa}
            aoMudar={(v) => setPlaca(v as Placa)}
            opcoes={PLACAS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
            obrigatorio
          />
          {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
          <div className="firmware-acoes-modal">
            <Botao variante="secundario" aoClicar={() => setNovo(false)}>
              Cancelar
            </Botao>
            <Botao tipo="submit" desabilitado={salvando || nome.trim() === ''}>
              {salvando ? 'Criando...' : 'Criar projeto'}
            </Botao>
          </div>
        </form>
      </Modal>

    </Pagina>
  );
}
