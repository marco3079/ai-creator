import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { TokenApiInfo } from '../../lib/tipos-api';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Modal,
  Pagina,
  Selo,
  Tabela,
  formatarDataHora,
} from '../../ui';
import type { ColunaTabela } from '../../ui';

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

interface TokenGerado {
  token: string;
  registro: TokenApiInfo;
}

// Mostra o token em claro uma única vez, logo após a criação.
function FormNovoToken({ aoGerado }: { aoGerado: (t: TokenGerado) => void }) {
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const resposta = await api.post<TokenGerado>('/tokens', { nome: nome.trim() });
      aoGerado(resposta);
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={gerar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo
        rotulo="Nome do token (ex.: VS Code de casa)"
        valor={nome}
        aoMudar={setNome}
        obrigatorio
      />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado || !nome.trim()}>
          Gerar token
        </Botao>
      </div>
    </form>
  );
}

function TokenMostrado({ token, aoFechar }: { token: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(token);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div>
      <Aviso tipo="info">
        Este token aparece somente agora. Copie e guarde em local seguro; depois não será possível vê-lo de novo.
      </Aviso>
      <div className="sistema-token">
        <code>{token}</code>
      </div>
      <div className="pagina-acoes">
        <Botao variante="secundario" aoClicar={copiar}>
          {copiado ? 'Copiado' : 'Copiar'}
        </Botao>
        <Botao aoClicar={aoFechar}>Concluir</Botao>
      </div>
    </div>
  );
}

export function Tokens() {
  const { dados, carregando, erro, recarregar } = useDados<TokenApiInfo[]>('/tokens');
  const [novo, setNovo] = useState(false);
  const [gerado, setGerado] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function revogar(t: TokenApiInfo) {
    if (!window.confirm(`Revogar o token "${t.nome}"? Quem o usa deixará de ter acesso.`)) return;
    setErroAcao(null);
    try {
      await api.del(`/tokens/${t.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  function fecharNovo() {
    setNovo(false);
    setGerado(null);
  }

  const colunas: ColunaTabela<TokenApiInfo>[] = [
    { titulo: 'Nome', celula: (t) => <strong>{t.nome}</strong> },
    { titulo: 'Prefixo', celula: (t) => <code>{t.prefixo}</code> },
    { titulo: 'Criado em', celula: (t) => formatarDataHora(t.criadoEm) },
    { titulo: 'Último uso', celula: (t) => (t.ultimoUso ? formatarDataHora(t.ultimoUso) : 'Nunca') },
    {
      titulo: 'Situação',
      celula: (t) => (t.revogado ? <Selo cor="vermelho">REVOGADO</Selo> : <Selo cor="verde">ATIVO</Selo>),
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (t) =>
        t.revogado ? null : (
          <Botao variante="perigo" aoClicar={() => revogar(t)}>
            Revogar
          </Botao>
        ),
    },
  ];

  return (
    <Pagina titulo="Tokens de API" acoes={<Botao aoClicar={() => setNovo(true)}>Gerar token</Botao>}>
      <p className="sistema-ajuda">
        Tokens permitem que o VS Code e o Claude Code acessem o AI Creator em seu nome. Use-os no lugar da
        senha. Cada token vale só para o seu usuário.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <Tabela<TokenApiInfo>
          chave={(t) => t.id}
          dados={dados}
          vazio="Você ainda não tem tokens de API."
          colunas={colunas}
        />
      )}

      <Modal aberto={novo} titulo={gerado ? 'Token criado' : 'Gerar token'} aoFechar={fecharNovo}>
        {novo &&
          (gerado ? (
            <TokenMostrado token={gerado} aoFechar={fecharNovo} />
          ) : (
            <FormNovoToken
              aoGerado={(resposta) => {
                setGerado(resposta.token);
                recarregar();
              }}
            />
          ))}
      </Modal>
    </Pagina>
  );
}
