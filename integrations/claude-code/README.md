# Plugin AI Creator para o Claude Code

Plugin que conecta o Claude Code ao AI Creator. Ele traz um servidor MCP com ferramentas para agentes, projetos de firmware e treino TinyML, além de três comandos de barra.

## Instalação

1. Gere um token em **Tokens de API** no AI Creator (começa com `aic_`).
2. Defina as variáveis de ambiente antes de abrir o Claude Code:
   - `AI_CREATOR_URL`: endereço do AI Creator, ex.: `http://localhost:8080` (padrão, se não definido).
   - `AI_CREATOR_TOKEN`: o token `aic_...` (obrigatório).
3. Instale o plugin a partir desta pasta (`integrations/claude-code`) pelo mecanismo de plugins do Claude Code.

O servidor MCP roda direto de `mcp-server/dist/index.js`, já compilado e versionado. Não é preciso instalar nada para usá-lo. Para recompilar após mudar o código-fonte: `cd mcp-server && npm install && npm run build`.

## Ferramentas MCP

| Ferramenta | Função |
|---|---|
| `listar_agentes` | Lista agentes LLM e TinyML (filtros `tipo` e `busca`). |
| `ler_agente` | Lê um agente completo (id ou slug). |
| `salvar_agente` | Cria (sem `id`) ou atualiza (com `id`) um agente. |
| `exportar_agente_md` | Exporta um agente LLM como subagente Markdown do Claude Code. |
| `importar_agente_md` | Importa um subagente Markdown; atualiza se o slug já existir. |
| `listar_projetos` | Lista os projetos de firmware. |
| `listar_arquivos` | Lista os arquivos de um projeto (id ou slug). |
| `ler_arquivo` | Lê um arquivo de um projeto. |
| `escrever_arquivo` | Cria ou substitui um arquivo de um projeto. |
| `compilar_projeto` | Compila no servidor, acompanha o build e devolve o status e o fim do log. |
| `status_build` | Status de um build e últimas linhas do log. |
| `listar_datasets` | Lista os datasets de treino. |
| `treinar_agente` | Inicia o treino de um agente TinyML com um dataset. |
| `status_treino` | Status, métricas e últimas linhas do log de um treino. |

Ao todo são 14 ferramentas.

## Comandos de barra

| Comando | Função |
|---|---|
| `/ai-compilar [pasta]` | Compila o projeto da pasta (lê `.aicreator.json`) e mostra o resultado. |
| `/ai-sincronizar-agentes` | Baixa os agentes LLM para `.claude/agents/`. Arquivos locais diferentes do servidor são listados e só são enviados com confirmação. |
| `/ai-treinar [agente] [dataset]` | Treina um agente TinyML e acompanha até o fim. |

## Segurança

- O token fica só na variável de ambiente do processo MCP. Não é gravado em arquivos do plugin.
- A ferramenta `compilar_projeto` e as de escrita usam o perfil do token (ADMIN ou DEV). Um token de LEITOR recebe erro 403 nas operações de escrita.
