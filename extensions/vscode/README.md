# AI Creator para VS Code

Extensão do AI Creator que traz agentes, projetos de firmware e compilações para o VS Code, falando com a API HTTP da plataforma.

## Recursos

- **Agentes** (barra de atividades > AI Creator): lista os agentes LLM e TinyML.
  - Baixar agente LLM para `.claude/agents/<slug>.md` (formato de subagente do Claude Code).
  - Baixar agente TinyML para `ai-creator/agentes/<slug>.json`.
  - Enviar um `.md` de `.claude/agents/` de volta à plataforma (comando, menu de contexto do explorer ou do editor).
- **Projetos**: lista os projetos com a placa de cada um.
  - Baixar projeto para `<pastaProjetos>/<slug>/`, com o arquivo `.aicreator.json` (vínculo com o projeto).
  - Enviar a pasta local ao servidor (após confirmação; arquivos removidos localmente também são removidos no servidor).
  - Compilar: envia o projeto, acompanha o build no canal "AI Creator" e oferece "Baixar firmware".
  - Gravar na placa com o PlatformIO local (`pio run -t upload`, em terminal integrado).
- **Abrir no navegador**: abre o agente ou projeto na interface web.

## Configuração

| Configuração | Padrão | Descrição |
|---|---|---|
| `aiCreator.url` | `http://localhost:8080` | Endereço do AI Creator. As chamadas vão para `<url>/api/...`. |
| `aiCreator.pastaProjetos` | `ai-creator` | Pasta dentro do workspace onde os projetos são baixados. |

Na primeira vez, use **AI Creator: Configurar token de API** e informe um token `aic_...` gerado em *Tokens de API* na plataforma. O token fica no armazenamento seguro do VS Code.

## Comandos

| Comando | Descrição |
|---|---|
| AI Creator: Configurar token de API | Salva e valida o token. |
| AI Creator: Atualizar listas | Recarrega as árvores Agentes e Projetos. |
| AI Creator: Baixar agente | Baixa um agente (LLM ou TinyML). |
| AI Creator: Enviar agente | Envia um `.md` de `.claude/agents/` para a plataforma. |
| AI Creator: Baixar projeto | Baixa os arquivos de um projeto. |
| AI Creator: Enviar projeto | Envia a pasta local do projeto. |
| AI Creator: Compilar projeto | Envia, compila e acompanha o log. |
| AI Creator: Gravar na placa (PlatformIO local) | Grava o firmware pelo `pio` instalado no computador. |
| AI Creator: Abrir no navegador | Abre o item selecionado na plataforma. |

## Requisitos

- VS Code 1.90 ou superior.
- Para gravar localmente: PlatformIO IDE (o comando `pio` precisa estar no PATH).

## Desenvolvimento

```bash
npm install
npm run compile
npm run package   # gera ai-creator-0.1.0.vsix
```
