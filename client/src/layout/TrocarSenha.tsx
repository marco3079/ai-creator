import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePlataforma } from '../lib/plataforma';
import { Aviso, Botao, Campo } from '../ui';
import { BotaoTema } from './Layout';
import './login.css';

// Troca de senha do usuário logado. Visual da tela de login (classes entrada-).
// Obrigatória quando usuario.trocarSenha é true (sem botão Voltar); por vontade própria mostra "Voltar".
export function TrocarSenha() {
  const { usuario, trocarSenha } = useAuth();
  const { plataforma, logoSrc } = usePlataforma();
  const navigate = useNavigate();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!usuario) return <Navigate to="/login" replace />;

  const obrigatoria = usuario.trocarSenha === true;

  function validar(): string | null {
    if (novaSenha.length < 8) return 'A nova senha deve ter pelo menos 8 caracteres';
    if (novaSenha === senhaAtual) return 'A nova senha deve ser diferente da atual';
    if (novaSenha.trim().toLowerCase() === usuario!.email.toLowerCase()) {
      return 'A nova senha não pode ser igual ao e-mail';
    }
    if (novaSenha !== confirmacao) return 'A confirmação não confere com a nova senha';
    return null;
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    const problema = validar();
    if (problema) {
      setErro(problema);
      return;
    }
    setEnviando(true);
    try {
      await trocarSenha(senhaAtual, novaSenha);
      navigate('/app', { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
      setEnviando(false);
    }
  }

  return (
    <main className="entrada">
      <div className="entrada-tema">
        <BotaoTema />
      </div>
      <aside className="entrada-marca">
        <div className="entrada-marca-topo">
          <img src={logoSrc} alt="" className="entrada-logo" width={56} height={56} />
          <span className="entrada-marca-nome">{plataforma.nome}</span>
        </div>
        <div className="entrada-marca-meio">
          <h2 className="entrada-frase">Sua conta, sua senha</h2>
          <p className="entrada-marca-apoio">Escolha uma senha que só você conheça.</p>
        </div>
      </aside>

      <section className="entrada-formulario">
        <form className="entrada-cartao" onSubmit={enviar}>
          <div className="entrada-cartao-marca">
            <img src={logoSrc} alt="" className="entrada-logo" width={56} height={56} />
            <span>{plataforma.nome}</span>
          </div>
          <h1 className="entrada-titulo">{obrigatoria ? 'Crie uma nova senha' : 'Trocar senha'}</h1>
          <p className="entrada-apoio">
            {obrigatoria
              ? 'Sua senha é temporária. Escolha uma nova para continuar.'
              : 'Informe a senha atual e escolha uma nova.'}
          </p>
          <Campo rotulo="Senha atual" tipo="password" valor={senhaAtual} aoMudar={setSenhaAtual} obrigatorio />
          <Campo rotulo="Nova senha" tipo="password" valor={novaSenha} aoMudar={setNovaSenha} obrigatorio />
          <Campo rotulo="Confirmar nova senha" tipo="password" valor={confirmacao} aoMudar={setConfirmacao} obrigatorio />
          <ul className="entrada-regras">
            <li>Pelo menos 8 caracteres</li>
            <li>Diferente da senha atual</li>
            <li>Não pode ser o seu e-mail</li>
          </ul>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="entrada-botao">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Salvando...' : 'Salvar nova senha'}
            </Botao>
          </div>
          {!obrigatoria && (
            <div className="entrada-botao">
              <Botao variante="secundario" aoClicar={() => navigate('/app')}>
                Voltar
              </Botao>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
