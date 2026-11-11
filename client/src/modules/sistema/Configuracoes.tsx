import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { usePlataforma } from '../../lib/plataforma';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Cartao, Pagina, Selo } from '../../ui';

interface Plataforma {
  nome: string;
  slogan: string;
  corPrimaria: string;
}

interface StatusLlm {
  ANTHROPIC: boolean;
  OPENAI: boolean;
  OLLAMA: boolean;
}

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Formulário montado só depois de carregar os dados, para iniciar os campos com os valores gravados.
function FormPlataforma({ inicial }: { inicial: Plataforma }) {
  const { recarregar } = usePlataforma();
  const [nome, setNome] = useState(inicial.nome);
  const [slogan, setSlogan] = useState(inicial.slogan);
  const [corPrimaria, setCorPrimaria] = useState(inicial.corPrimaria);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      await api.put<Plataforma>('/plataforma', {
        nome: nome.trim(),
        slogan: slogan.trim(),
        corPrimaria,
      });
      await recarregar();
      setSucesso('Configurações salvas.');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <Campo rotulo="Nome da plataforma" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="Slogan" valor={slogan} aoMudar={setSlogan} />
      <label className="campo">
        <span className="campo-rotulo">Cor primária</span>
        <input
          className="campo-controle"
          type="color"
          value={corPrimaria}
          onChange={(e) => setCorPrimaria(e.target.value)}
        />
      </label>
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado || !nome.trim()}>
          {ocupado ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  );
}

function StatusServicos() {
  const { dados, carregando, erro } = useDados<StatusLlm>('/llm/status');

  const linhas: { chave: keyof StatusLlm; rotulo: string; ativoRotulo: string; inativoRotulo: string }[] = [
    { chave: 'ANTHROPIC', rotulo: 'Anthropic', ativoRotulo: 'Chave configurada', inativoRotulo: 'Sem chave' },
    { chave: 'OPENAI', rotulo: 'OpenAI', ativoRotulo: 'Chave configurada', inativoRotulo: 'Sem chave' },
    { chave: 'OLLAMA', rotulo: 'Ollama', ativoRotulo: 'Respondendo', inativoRotulo: 'Indisponível' },
  ];

  return (
    <Cartao titulo="Status dos serviços">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <ul className="sistema-status">
          {linhas.map((l) => (
            <li key={l.chave}>
              <span>{l.rotulo}</span>
              {dados[l.chave] ? (
                <Selo cor="verde">{l.ativoRotulo}</Selo>
              ) : (
                <Selo cor="vermelho">{l.inativoRotulo}</Selo>
              )}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

export function Configuracoes() {
  const plataforma = useDados<Plataforma>('/plataforma');

  return (
    <Pagina titulo="Configurações">
      <Cartao titulo="Identidade">
        {plataforma.erro && <Aviso tipo="erro">{plataforma.erro}</Aviso>}
        {plataforma.carregando && !plataforma.dados && <Carregando />}
        {plataforma.dados && <FormPlataforma inicial={plataforma.dados} />}
      </Cartao>
      <StatusServicos />
    </Pagina>
  );
}
