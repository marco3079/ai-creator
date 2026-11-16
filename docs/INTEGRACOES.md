# Integrações: VS Code e Claude Code

Duas formas de trabalhar com os agentes e projetos do AI Creator fora do navegador: a extensão do VS Code e o servidor MCP com o plugin do Claude Code. As duas falam com a mesma API, usando um **token de API** (`aic_...`).

## Criar o token de API

Os dois precisam de um token:

1. Entre no AI Creator e abra **Tokens de API**, no menu.
2. Clique em **Gerar token** e dê um nome (ex.: "VS Code notebook").
3. Copie o token na hora. Ele aparece só uma vez. Se perder, gere outro e revogue o antigo.

O token tem as permissões do seu usuário: um `LEITOR` só consegue ler, e um `DEV` ou `ADMIN` consegue criar e editar.

A URL base é o endereço do site, por padrão `http://localhost:8080`. As chamadas vão para `<url>/api/...`.

## VS Code

### Instalar a extensão

A extensão fica em `extensions/vscode/`. Para instalar o pacote:

```bash
cd extensions/vscode
npm install
npm run compile
npx vsce package --no-dependencies
code --install-extension ai-creator-0.2.0.vsix
```

As versões publicadas também saem como arquivo `.vsix` na página de Releases do GitHub (veja [Publicar a extensão](#publicar-a-extensão)).

Depois, reinicie o VS Code. Um ícone do AI Creator aparece na barra de atividades.

### Configurar

1. Abra as configurações do VS Code e procure por `AI Creator`.
2. Em `aiCreator.url`, deixe o endereço do site (padrão `http://localhost:8080`).
3. Em `aiCreator.pastaProjetos`, escolha a pasta do workspace onde os projetos serão baixados (padrão `ai-creator`).
4. Rode o comando **AI Creator: Configurar token** e cole o token. Ele fica guardado no cofre de segredos do VS Code, não em arquivo.

### O que dá para fazer

As duas árvores da barra lateral mostram:

- **Agentes**: agentes LLM e TinyML da plataforma.
- **Projetos**: projetos de firmware, com a placa de cada um.

Comandos principais:

| Comando | O que faz |
|---|---|
| Baixar agente | LLM: grava `.claude/agents/<slug>.md` no workspace. TinyML: grava `ai-creator/agentes/<slug>.json` |
| Enviar agente | Envia um `.md` de `.claude/agents/` para a plataforma (cria ou atualiza) |
| Baixar projeto | Grava os arquivos do projeto em `<pastaProjetos>/<slug>/` e cria `.aicreator.json` |
| Enviar projeto | Envia a pasta do projeto, após confirmação. Ignora `.pio`, `.vscode`, `.aicreator.json` e binários maiores que 1 MB |
| Compilar | Envia o projeto, compila na plataforma e mostra o log no canal "AI Creator". Ao fim, oferece **Baixar firmware** |
| Gravar localmente | Roda `pio run -t upload` num terminal integrado. Pede a porta, se você quiser |
| Abrir no navegador | Abre a tela correspondente no site |
| Atualizar | Recarrega as árvores |

Para gravar localmente, instale o PlatformIO (pela extensão PlatformIO IDE ou pela linha de comando). Se o `pio` não estiver no caminho, a extensão mostra o link de instalação.

## Claude Code

O Claude Code conversa com a plataforma por um **servidor MCP** (em `integrations/claude-code/mcp-server/`). Há dois jeitos de instalar.

### Opção 1: comando `claude mcp add`

Na pasta onde você trabalha, rode (troque os valores):

```bash
claude mcp add ai-creator \
  --env AI_CREATOR_URL=http://localhost:8080 \
  --env AI_CREATOR_TOKEN=aic_seu_token_aqui \
  -- node /caminho/para/ai-creator/integrations/claude-code/mcp-server/dist/index.js
```

O servidor já vem compilado em `dist/`, então não é preciso rodar o build para usar.

Alternativa sem o comando: copie `.mcp.json.exemplo` para `.mcp.json` na pasta do seu projeto, troque o token e ajuste o caminho.

### Opção 2: plugin pelo marketplace

Dentro do Claude Code:

```
/plugin marketplace add marco3079/ai-creator
/plugin install ai-creator
```

O plugin registra o servidor MCP e quatro comandos. Antes de usar, defina as variáveis `AI_CREATOR_URL` e `AI_CREATOR_TOKEN` no ambiente.

### Comandos do plugin

| Comando | O que faz |
|---|---|
| `/ai-compilar` | Compila o projeto da pasta atual, lendo `.aicreator.json`, e mostra o resultado |
| `/ai-sincronizar-agentes` | Baixa todos os agentes LLM para `.claude/agents/` e envia os locais que mudaram |
| `/ai-treinar` | Treina um agente TinyML com um dataset escolhido |
| `/ai-treinar-modelo` | Treina um modelo (TinyML, tabular, LLM na nuvem ou LLM local), acompanha até o fim e relata as métricas |

### Ferramentas MCP

O Claude pode usar estas ferramentas diretamente na conversa:

| Ferramenta | Para que serve |
|---|---|
| `listar_agentes` | Lista agentes, filtrando por tipo (`LLM` ou `TINYML`) e busca |
| `ler_agente` | Mostra um agente pelo id |
| `salvar_agente` | Cria (sem id) ou atualiza (com id) um agente |
| `exportar_agente_md` | Devolve o agente no formato de subagente do Claude Code |
| `importar_agente_md` | Importa um agente a partir do texto `.md` |
| `listar_projetos` | Lista os projetos de firmware |
| `listar_arquivos` | Lista os arquivos de um projeto |
| `ler_arquivo` | Lê um arquivo de um projeto |
| `escrever_arquivo` | Grava um arquivo de um projeto |
| `compilar_projeto` | Compila, espera o resultado e devolve o status e as últimas 80 linhas do log |
| `status_build` | Mostra o status de uma compilação |
| `listar_datasets` | Lista os datasets |
| `treinar_agente` | Inicia o treino de um agente TinyML com um dataset |
| `status_treino` | Mostra o status de um treino de agente TinyML |
| `listar_modelos` | Lista os modelos, com filtros por tipo e busca |
| `criar_modelo` | Cria um modelo com tipo, tarefa e dataset padrão |
| `treinar_modelo` | Inicia um treino de modelo (id ou slug) e devolve o treino criado |
| `status_treino_modelo` | Mostra status, métrica principal, modelo resultante (LLM) e últimas 60 linhas do log de um treino de modelo |

O campo `projeto` aceita o id ou o slug, e o campo `modelo` aceita o id ou o slug do modelo.

### Exemplo de uso

> Compile o projeto `blink-esp32` com o agente `detector-de-gestos` e me mostre os erros, se houver.

O Claude usa `compilar_projeto` com o modelo TinyML do agente, espera o resultado e explica o log.

## Agente com ferramentas da plataforma

Um agente LLM pode ler, editar e compilar um projeto de firmware sozinho, usando as ferramentas da própria plataforma. Assim, o agente pode ver os erros do compilador, corrigir o código e compilar de novo.

### Como ligar

1. Abra o agente LLM no editor e vincule um **projeto**. Sem projeto vinculado, as ferramentas ficam desabilitadas, e o servidor também as ignora.
2. Marque as ferramentas da plataforma:

| Ferramenta (`aic.*`) | O que faz |
|---|---|
| `aic.listar_arquivos` | Lista os arquivos do projeto |
| `aic.ler_arquivo` | Lê um arquivo do projeto |
| `aic.escrever_arquivo` | Grava um arquivo do projeto |
| `aic.compilar` | Compila o projeto e devolve o resultado |

Os caminhos são sempre relativos ao projeto vinculado. Caminhos com `..` ou absolutos são recusados, então o agente não enxerga outros projetos nem arquivos do servidor.

### Provedores

- **Claude (Anthropic)** e **OpenAI** usam as ferramentas.
- **Ollama** roda sem ferramentas. A execução avisa isso e segue só com o texto.

### Limites

- Cada execução aceita até 15 rodadas de ferramentas. Se o agente passar disso sem terminar, a execução falha com uma mensagem de erro.
- `aic.escrever_arquivo` aceita até 200 KB por arquivo.
- `aic.compilar` espera a compilação terminar por até 10 minutos. A resposta traz o status e as últimas 80 linhas do log.
- Se a resposta for cortada no meio de uma ferramenta por limite de tokens, aumente o máximo de tokens do agente.

Cada rodada do modelo conta nos tokens do agente. O consumo aparece em **Uso e custos** (veja [API.md](API.md#uso-e-custos-apiuso)).

### Exemplo de uso

> Compile o projeto `blink-esp32`, leia o erro do compilador e corrija o arquivo `src/main.cpp`. Compile de novo até passar.

## Publicar a extensão

A extensão do VS Code é publicada por um workflow do GitHub (`.github/workflows/release-vscode.yml`). Ele roda quando você envia uma tag `vscode-v*` (por exemplo, `vscode-v0.2.0`), ou pelo botão de execução manual.

1. Atualize a versão em `extensions/vscode/package.json` e escreva a mudança em `extensions/vscode/CHANGELOG.md`.
2. Crie e envie a tag, por exemplo `git tag vscode-v0.2.0` e `git push origin vscode-v0.2.0`.
3. O workflow compila a extensão, gera o `.vsix` e cria (ou atualiza) a Release do GitHub com o arquivo anexado.
4. A publicação no Marketplace roda `vsce publish` com o segredo `VSCE_PAT`. Ela só acontece se esse segredo estiver configurado no repositório. Sem o segredo, a Release sai e a publicação é pulada.

Para publicar no Marketplace, o token `VSCE_PAT` precisa ser de um publisher com permissão de publicação. Guarde o token só como segredo do GitHub, nunca no código.

## Problemas comuns

- **"Token inválido" ou erro 401**: o token foi revogado, copiado com espaços ou não tem o prefixo `aic_`. Gere outro.
- **"Sem permissão" ou erro 403**: o token é de um `LEITOR`. Peça a um administrador um perfil `DEV`.
- **A extensão não conecta**: confira `aiCreator.url`. Em Docker, o endereço costuma ser `http://localhost:8080`.
- **O MCP não aparece no Claude Code**: rode `/mcp` para ver o estado do servidor e confira o caminho do `dist/index.js`.
