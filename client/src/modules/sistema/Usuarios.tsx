import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import {
  Aviso,
  Botao,
  Campo,
  Caixa,
  Carregando,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import type { ColunaTabela } from '../../ui';

interface UsuarioAdmin {
  id: number;
  nome: string;
  email: string;
  perfil: 'ADMIN' | 'DEV' | 'LEITOR';
  ativo: boolean;
  criadoEm: string;
}

const PERFIS: { valor: string; rotulo: string }[] = [
  { valor: 'ADMIN', rotulo: 'Administrador' },
  { valor: 'DEV', rotulo: 'Desenvolvedor' },
  { valor: 'LEITOR', rotulo: 'Leitor' },
];

const rotuloPerfil = (perfil: string) => PERFIS.find((p) => p.valor === perfil)?.rotulo ?? perfil;

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Criar (sem usuario) ou editar. Na edição a senha é opcional: vazia, mantém a atual.
function FormUsuario({
  usuario,
  aoConcluir,
}: {
  usuario: UsuarioAdmin | null;
  aoConcluir: () => void;
}) {
  const editando = usuario !== null;
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [senha, setSenha] = useState('');
  const [perfil, setPerfil] = useState<string>(usuario?.perfil ?? '');
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      if (editando) {
        const corpo: Record<string, unknown> = {
          nome: nome.trim(),
          email: email.trim(),
          perfil,
          ativo,
        };
        if (senha) corpo.senha = senha;
        await api.put(`/usuarios/${usuario.id}`, corpo);
      } else {
        await api.post('/usuarios', { nome: nome.trim(), email: email.trim(), senha, perfil });
      }
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
      <Campo
        rotulo={editando ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial (mínimo 6 caracteres)'}
        tipo="password"
        valor={senha}
        aoMudar={setSenha}
        obrigatorio={!editando}
      />
      <Selecao rotulo="Perfil" valor={perfil} aoMudar={setPerfil} opcoes={PERFIS} obrigatorio />
      {editando && <Caixa rotulo="Ativo" marcado={ativo} aoMudar={setAtivo} />}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          {editando ? 'Salvar' : 'Criar usuário'}
        </Botao>
      </div>
    </form>
  );
}

export function Usuarios() {
  const { usuario: eu } = useAuth();
  const { dados, carregando, erro, recarregar } = useDados<UsuarioAdmin[]>('/usuarios');
  // null: fechado; 'novo': criar; objeto: editar.
  const [modal, setModal] = useState<UsuarioAdmin | 'novo' | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function excluir(u: UsuarioAdmin) {
    if (!window.confirm(`Excluir o usuário ${u.nome}? Esta ação não pode ser desfeita.`)) return;
    setErroAcao(null);
    try {
      await api.del(`/usuarios/${u.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const colunas: ColunaTabela<UsuarioAdmin>[] = [
    { titulo: 'Nome', celula: (u) => <strong>{u.nome}</strong> },
    { titulo: 'E-mail', celula: (u) => u.email },
    { titulo: 'Perfil', celula: (u) => <Selo cor="azul">{rotuloPerfil(u.perfil)}</Selo> },
    {
      titulo: 'Situação',
      celula: (u) => (u.ativo ? <Selo cor="verde">ATIVO</Selo> : <Selo cor="vermelho">INATIVO</Selo>),
    },
    { titulo: 'Criado em', celula: (u) => formatarDataHora(u.criadoEm) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (u) => (
        <span className="sistema-acoes">
          <Botao variante="texto" aoClicar={() => setModal(u)}>
            Editar
          </Botao>
          {u.id !== eu?.id && (
            <Botao variante="perigo" aoClicar={() => excluir(u)}>
              Excluir
            </Botao>
          )}
        </span>
      ),
    },
  ];

  const editando = modal !== null && modal !== 'novo' ? modal : null;

  return (
    <Pagina titulo="Usuários" acoes={<Botao aoClicar={() => setModal('novo')}>Novo usuário</Botao>}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <Tabela<UsuarioAdmin>
          chave={(u) => u.id}
          dados={dados}
          vazio="Nenhum usuário cadastrado."
          colunas={colunas}
        />
      )}

      <Modal
        aberto={modal !== null}
        titulo={modal === 'novo' || modal === null ? 'Novo usuário' : `Editar ${modal.nome}`}
        aoFechar={() => setModal(null)}
      >
        {modal !== null && (
          <FormUsuario
            key={editando ? editando.id : 'novo'}
            usuario={editando}
            aoConcluir={() => {
              setModal(null);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
