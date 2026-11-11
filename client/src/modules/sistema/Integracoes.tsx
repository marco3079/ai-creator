import { useState } from 'react';
import { Botao, Cartao, Grade, Pagina } from '../../ui';

const FERRAMENTAS_MCP = [
  'listar_agentes',
  'ler_agente',
  'salvar_agente',
  'exportar_agente_md',
  'listar_projetos',
  'ler_arquivo',
  'escrever_arquivo',
  'compilar_projeto',
  'status_build',
  'treinar_agente',
  'status_treino',
];

// Bloco de código com botão Copiar.
function BlocoCodigo({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="sistema-bloco">
      <pre>
        <code>{texto}</code>
      </pre>
      <Botao variante="secundario" aoClicar={copiar}>
        {copiado ? 'Copiado' : 'Copiar'}
      </Botao>
    </div>
  );
}

export function Integracoes() {
  const origem = window.location.origin;

  return (
    <Pagina titulo="VS Code e Claude Code">
      <p className="sistema-ajuda">
        As duas integrações usam a mesma API do AI Creator. Antes de configurar, gere um token em{' '}
        <a href="/app/tokens">Tokens de API</a>.
      </p>

      <Grade>
        <Cartao titulo="VS Code">
          <ol className="sistema-passos">
            <li>
              <strong>Instalar a extensão.</strong> Gere o arquivo <code>.vsix</code> a partir de{' '}
              <code>extensions/vscode</code> e instale pelo terminal:
              <BlocoCodigo texto="code --install-extension ai-creator-<versao>.vsix" />
            </li>
            <li>
              <strong>Configurar a URL.</strong> Use o endereço deste sistema:
              <BlocoCodigo texto={origem} />
            </li>
            <li>
              <strong>Configurar o token.</strong> Cole em <em>AI Creator: Token</em> o token gerado em{' '}
              <a href="/app/tokens">Tokens de API</a>.
            </li>
          </ol>
          <h3 className="sistema-subtitulo">O que dá para fazer</h3>
          <ul className="sistema-lista">
            <li>Navegar pela árvore de agentes e projetos.</li>
            <li>Baixar e enviar arquivos de firmware.</li>
            <li>Compilar o projeto no servidor.</li>
            <li>Gravar o firmware na placa pela USB, via PlatformIO, no seu computador.</li>
          </ul>
        </Cartao>

        <Cartao titulo="Claude Code">
          <p>Adicionar o servidor MCP com o seu token:</p>
          <BlocoCodigo
            texto={`claude mcp add ai-creator --env AI_CREATOR_URL=${origem} --env AI_CREATOR_TOKEN=<seu-token> -- node <caminho>/integrations/claude-code/mcp-server/dist/index.js`}
          />
          <p>Alternativa, pelo plugin:</p>
          <BlocoCodigo texto={'/plugin marketplace add marco3079/ai-creator\n/plugin install ai-creator'} />
          <h3 className="sistema-subtitulo">Ferramentas disponíveis</h3>
          <ul className="sistema-lista sistema-lista-colunas">
            {FERRAMENTAS_MCP.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        </Cartao>
      </Grade>
    </Pagina>
  );
}
