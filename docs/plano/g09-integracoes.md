# g09 — Extensão do VS Code + MCP/plugin do Claude Code

Leia antes: `docs/plano/CONTRATOS.md` (§3 inteiro — você só consome a API; §5).

## Arquivos que você pode criar/editar (só estes)
- `extensions/vscode/**`
- `integrations/claude-code/**`

## Parte A — extensão VS Code (`extensions/vscode/`)
1. `package.json`: name `ai-creator`, displayName "AI Creator", publisher `marco3079`, version `0.1.0`, `engines.vscode: "^1.90.0"`, `main: ./out/extension.js`, scripts `compile: tsc -p .`, `package: vsce package --no-dependencies`. devDependencies fixas: `typescript 5.6.3`, `@types/vscode 1.90.0`, `@types/node 20.17.6`, `@vscode/vsce 3.2.1`. Sem dependências de runtime (use `fetch` do Node 18+).
   `contributes`: `viewsContainers.activitybar` (`aiCreator`, ícone `media/icone.svg`), views `aiCreator.agentes` ("Agentes") e `aiCreator.projetos` ("Projetos"); `configuration`: `aiCreator.url` (padrão `http://localhost:8080`), `aiCreator.pastaProjetos` (padrão `ai-creator`); comandos: `aiCreator.configurarToken`, `aiCreator.atualizar`, `aiCreator.baixarAgente`, `aiCreator.enviarAgente`, `aiCreator.baixarProjeto`, `aiCreator.enviarProjeto`, `aiCreator.compilar`, `aiCreator.gravarLocal`, `aiCreator.abrirNoNavegador`; menus `view/title` e `view/item/context` adequados; `viewsWelcome` pedindo para configurar o token.
2. `src/api.ts`: cliente com URL da configuração + token do `context.secrets` (`aiCreator.token`). Erros viram `vscode.window.showErrorMessage`.
3. `src/arvores.ts`: `TreeDataProvider` de agentes (agrupa LLM/TinyML; ícones `hubot`/`circuit-board`) e de projetos (placa na descrição).
4. `src/comandos.ts`:
   - baixarAgente: LLM → grava `.claude/agents/<slug>.md` no workspace (`GET /agentes/:id/exportar?formato=md`) e abre; TinyML → grava `ai-creator/agentes/<slug>.json`.
   - enviarAgente: com um `.md` em `.claude/agents/` aberto (ou escolhido), `POST /agentes/importar` (formato md). Também oferecido no menu de contexto do explorer para `*.md` dentro de `.claude/agents`.
   - baixarProjeto: `GET /projetos/:id/arquivos?conteudo=1` → grava em `<workspace>/<pastaProjetos>/<slug>/`, cria `.aicreator.json` `{projetoId, slug}` na pasta.
   - enviarProjeto: lê todos os arquivos da pasta (ignora `.pio`, `.vscode`, `.aicreator.json`, binários > 1 MB) → `PUT /projetos/:id/arquivos` `{arquivos, removerAusentes:true}` após confirmação.
   - compilar: envia o projeto, `POST /projetos/:id/build`, faz polling e escreve o log num `OutputChannel` "AI Creator"; ao fim, notificação com "Baixar firmware".
   - gravarLocal: roda num terminal integrado `pio run -d "<pasta>" -t upload` (pede porta opcional `--upload-port`). Se `pio` não existir, mensagem com link de instalação do PlatformIO IDE.
   - abrirNoNavegador: `vscode.env.openExternal(<url>/app/...)`.
5. `media/icone.svg` (monocromático, `currentColor`), `README.md` da extensão (recursos, configuração, comandos), `.vscodeignore`, `tsconfig.json` (`module commonjs`, `target ES2022`, `outDir out`, strict), `CHANGELOG.md`.

## Parte B — MCP do Claude Code (`integrations/claude-code/`)
6. Estrutura de plugin do Claude Code:
   - `integrations/claude-code/.claude-plugin/plugin.json`: `{ "name": "ai-creator", "version": "0.1.0", "description": "...", "author": { "name": "marco3079" } }`
   - `integrations/claude-code/.mcp.json`: `{ "mcpServers": { "ai-creator": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"], "env": { "AI_CREATOR_URL": "${AI_CREATOR_URL}", "AI_CREATOR_TOKEN": "${AI_CREATOR_TOKEN}" } } } }`
   - `integrations/claude-code/commands/ai-compilar.md` (compila o projeto da pasta atual lendo `.aicreator.json` e mostra o resultado), `ai-sincronizar-agentes.md` (baixa todos os agentes LLM da plataforma para `.claude/agents/` e envia os locais alterados), `ai-treinar.md` (treina um agente TinyML com um dataset). Frontmatter `description:` e corpo instruindo o uso das ferramentas MCP.
   - `integrations/claude-code/README.md`.
7. `mcp-server/package.json`: `type: module`, deps fixas `@modelcontextprotocol/sdk 1.32.2`, `zod 3.25.76`; dev `typescript 5.6.3`, `@types/node 20.17.6`; script `build: tsc`. **Confira** a API instalada em `node_modules/@modelcontextprotocol/sdk` (`McpServer` de `server/mcp.js`, `StdioServerTransport` de `server/stdio.js`, `registerTool` ou `tool`) e a versão de zod que ela pede (`npm view @modelcontextprotocol/sdk@1.32.2 peerDependencies dependencies`) antes de escrever; ajuste o zod se necessário.
8. `mcp-server/src/index.ts`: lê `AI_CREATOR_URL` (padrão `http://localhost:8080`) e `AI_CREATOR_TOKEN` (obrigatório; erro claro no stderr). Ferramentas (descrições em português, entrada validada por zod, saída `content: [{type:'text', text: JSON ou texto}]`, `isError: true` em falha):
   `listar_agentes {tipo?, busca?}`, `ler_agente {id}`, `salvar_agente {id?, dados}` (POST se sem id, PUT se com), `exportar_agente_md {id}`, `importar_agente_md {conteudo}`, `listar_projetos {}`, `listar_arquivos {projeto}`, `ler_arquivo {projeto, caminho}`, `escrever_arquivo {projeto, caminho, conteudo}`, `compilar_projeto {projeto, agenteId?, aguardarSegundos? (padrão 300)}` (faz polling e devolve status + últimas 80 linhas do log), `status_build {id}`, `listar_datasets {}`, `treinar_agente {id, datasetId, parametros?}`, `status_treino {id}`. `projeto` aceita id ou slug.
9. Compile (`npm install && npm run build`) e **mantenha `mcp-server/dist/` versionado** (o plugin roda direto dele). `mcp-server/.gitignore` só com `node_modules`.

## Aceite / verificação
- `cd extensions/vscode && npm install && npm run compile` sem erros; `npx vsce package --no-dependencies` gera o `.vsix` (não versionar o .vsix).
- `cd integrations/claude-code/mcp-server && npm install && npm run build` sem erros; `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | AI_CREATOR_TOKEN=x node dist/index.js` precisa de handshake — em vez disso rode um script que inicialize via `initialize` + `tools/list` e confirme as 15 ferramentas. Publique a saída.
