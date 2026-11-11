# Plano — AI Creator

Plataforma web (Docker) para criar, editar, versionar e executar **agentes de IA** em dois formatos:

- **LLM** — prompt de sistema, modelo (Claude, OpenAI ou Ollama local), esforço/temperatura, ferramentas. Exporta/importa no formato de subagente do Claude Code (`.claude/agents/*.md`). Playground com streaming.
- **TinyML** — classificador para microcontrolador: dataset CSV → treino Keras → TFLite INT8 → `model_data.h` → embutido no firmware.

E o ciclo de firmware: projetos PlatformIO (ESP32, ESP32-S3, Arduino Nano 33 BLE, Uno, STM32 Nucleo, RP2040), compilação no container `builder`, download do binário, gravação pelo navegador (Web Serial/esptool-js, ESP32) ou localmente pela extensão do VS Code (`pio run -t upload`).

Integrações: extensão do **VS Code** (árvore de agentes/projetos, baixar/enviar, compilar, gravar) e **servidor MCP + plugin do Claude Code** (ferramentas para listar/editar agentes e arquivos, compilar e treinar).

Layout: o mesmo do `sistema-escolar` (barra lateral com grupos, topo com busca, tema claro/escuro, cartões de KPI, painel com gráfico e atalhos).

## Divisão (squad)

| Gerador | Parte | Mini-plano |
|---|---|---|
| g01 | Base do servidor + auth, usuários, tokens, plataforma, logs, painel, seed, Dockerfile | `g01-servidor-base.md` |
| g02 | Base do cliente (casca, ui, lib, login, painel inicial), Dockerfile + nginx | `g02-cliente-base.md` |
| g03 | Servidor: agentes, versões, import/export `.md`, execução LLM (SSE), conversas | `g03-servidor-agentes.md` |
| g04 | Cliente: lista de agentes, editor LLM/TinyML, playground, versões, import/export | `g04-cliente-agentes.md` |
| g05 | Serviço `trainer/` (Python/TensorFlow) + servidor: datasets e treinos | `g05-trainer.md` |
| g06 | Cliente: TinyML (formulário, aba de treino, datasets) + telas de sistema | `g06-cliente-tinyml-sistema.md` |
| g07 | Serviço `builder/` (PlatformIO) + servidor: projetos, builds, dispositivos | `g07-builder.md` |
| g08 | Cliente: projetos (editor de arquivos), compilações, gravação Web Serial, dispositivos | `g08-cliente-firmware.md` |
| g09 | Extensão VS Code + servidor MCP/plugin do Claude Code | `g09-integracoes.md` |
| g10 | docker-compose, instaladores, README e arquivos de repositório profissional, CI | `g10-repositorio.md` |

Contratos em `CONTRATOS.md`. Arquivos escritos pelo `main` (somente leitura para geradores):
`server/prisma/schema.prisma`, `server/src/modules/llm/provedores/tipos.ts`, `server/src/modules/llm/provedores/anthropic.ts`, `docs/plano/*`.
