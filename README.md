<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/imagens/logo-escuro.png">
    <img src="docs/imagens/logo-claro.png" alt="AI Creator" width="460">
  </picture>
</p>

<p align="center">Crie, versione e execute agentes de IA e classificadores TinyML, e leve o firmware até a placa, em um único app web.</p>

<p align="center">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT">
  <img src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" alt="Express 4">
  <img src="https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma&logoColor=white" alt="Prisma 5">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/TensorFlow%20Lite-FF6F00?logo=tensorflow&logoColor=white" alt="TensorFlow Lite">
  <img src="https://img.shields.io/badge/PlatformIO-F5822A?logo=platformio&logoColor=white" alt="PlatformIO">
  <img src="https://img.shields.io/badge/Claude-D97757?logo=anthropic&logoColor=white" alt="Claude">
</p>

<p align="center"><img src="docs/imagens/painel-claro.png" alt="Painel inicial do AI Creator" width="900"></p>

## Sumário

- [Visão geral](#visão-geral)
- [Recursos](#recursos)
  - [Modelos](#modelos)
  - [Frota e OTA](#frota-e-ota)
  - [Como atualizar](#como-atualizar)
- [Telas](#telas)
- [Placas suportadas](#placas-suportadas)
- [Arquitetura](#arquitetura)
- [Início rápido](#início-rápido)
- [Primeiro acesso](#primeiro-acesso)
- [Configuração](#configuração)
- [Integrações](#integrações)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Desenvolvimento](#desenvolvimento)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)
- [Segurança](#segurança)
- [Licença](#licença)

## Visão geral

O AI Creator é uma plataforma web, instalada com Docker, para trabalhar com dois tipos de agente de IA e levar o resultado até o microcontrolador:

- **Agentes LLM**: um prompt de sistema, um modelo (Claude, OpenAI ou Ollama local), esforço ou temperatura e ferramentas. Dá para testar no playground com resposta em tempo real, guardar versões, exportar e importar no formato de subagente do Claude Code (`.claude/agents/*.md`).
- **Agentes TinyML**: um classificador para microcontrolador. Você envia um dataset em CSV, a plataforma treina um modelo, converte para TFLite INT8 e gera o `model_data.h`, pronto para entrar no firmware.

Sobre os agentes, o AI Creator também cuida do firmware: projetos PlatformIO (com editor de arquivos no navegador), compilação em um contêiner próprio, download do binário e gravação pelo navegador (Web Serial) ou pelo servidor, no Linux.

Quem trabalha no computador pode usar a extensão do VS Code e o servidor MCP com o plugin do Claude Code, que falam com a mesma API.

## Recursos

- **Agentes LLM**: provedores Claude, OpenAI e Ollama, playground com streaming (SSE), conversas salvas, uso e custo de tokens por agente e por provedor.
- **Agentes com ferramentas**: um agente LLM vinculado a um projeto lê, edita e compila o firmware pelas ferramentas da plataforma (Claude e OpenAI).
- **Agentes TinyML**: formulário de configuração, treino em segundo plano, métricas, matriz de confusão e download do `.tflite` e do `model_data.h`.
- **Datasets e treinos**: importação de CSV com prévia, amostra, download e histórico de treinos.
- **Fila e tempo real**: treinos e compilações entram numa fila guardada no banco, e uma vigia recupera trabalhos perdidos quando um serviço reinicia. O andamento aparece ao vivo (SSE), sem recarregar a tela.
- **Firmware**: projetos PlatformIO, editor de arquivos, compilações com log, dispositivos cadastrados, gravação por Web Serial ou pelo servidor.
- **Histórico do projeto**: versões manuais e automáticas a cada compilação, comparação linha a linha, restaurar uma versão e baixar o histórico como repositório Git.
- **Monitor serial e coleta**: leia a saída serial da placa no navegador (Web Serial) e grave exemplos rotulados como dataset de série temporal. Sem placa, a coleta funciona com um simulador.
- **Áudio e palavra-chave**: modelo TinyML que classifica palavras-chave a partir de arquivos `.wav`, com o mesmo cálculo de características na placa.
- **Frota e OTA**: placas ESP32 e ESP32-S3 com o firmware OTA entram na frota, mandam telemetria por MQTT e atualizam o firmware pelo Wi-Fi.
- **VS Code**: árvore de agentes e projetos, baixar e enviar, compilar e gravar a placa pelo PlatformIO.
- **Claude Code e MCP**: ferramentas para listar e editar agentes e arquivos, compilar e treinar, além de comandos de plugin (`/ai-compilar`, `/ai-sincronizar-agentes`, `/ai-treinar`, `/ai-treinar-modelo`).
- **Usuários e acesso**: perfis ADMIN, DEV e LEITOR, troca de senha no primeiro acesso, tokens de API para integrações e registro de atividades.
- **Segurança**: segredos gerados e guardados no servidor, chave de cada placa (o servidor guarda só o hash) e broker MQTT com usuário e senha.
- **Atualização pelo painel**: em Sistema > Atualização, o administrador verifica se há versão nova no GitHub, faz uma cópia do banco e atualiza o sistema, reconstruindo só o que mudou. Veja [Como atualizar](#como-atualizar).
- **Visual**: tema claro e escuro, painel com indicadores, uso no celular e instalação como app (PWA).

Para o que ainda precisa de teste com hardware ou chaves de API, veja [O que ainda precisa de teste com hardware ou chaves](TESTAR.md).

### Modelos

Na área **Modelos** você cria um modelo, treina quantas vezes quiser e publica o treino que vai usar. Há quatro tipos: **TinyML** (rede neural para a placa, exporta TFLite INT8 e `model_data.h`), **tabular** (algoritmos do scikit-learn, exporta C quando o algoritmo permite), **LLM na nuvem** (ajuste fino da OpenAI) e **LLM local** (ajuste fino com LoRA numa GPU NVIDIA, registrado no Ollama). Modelos TinyML e tabulares podem ser embutidos no firmware; modelos LLM viram agentes. Antes de gravar, a aba **Testar** roda a versão no servidor com o mesmo arquivo que vai para a placa.

Veja o guia completo, com formatos de dataset, exemplos e custos, em [docs/MODELOS.md](docs/MODELOS.md).

### Frota e OTA

Com o modelo de projeto **OTA**, uma placa ESP32 ou ESP32-S3 entra na frota: ela publica telemetria (sinal Wi-Fi, memória, versão do firmware) por MQTT, aparece como online ou offline e recebe a atualização de firmware pelo ar. Você gera a chave da placa, baixa o `aic_config.h`, grava a primeira vez por USB e, daí em diante, define a versão e atualiza sem cabo. O passo a passo está em [docs/FIRMWARE.md](docs/FIRMWARE.md#frota-e-ota).

Os detalhes de cada parte estão em [docs/TINYML.md](docs/TINYML.md), [docs/FIRMWARE.md](docs/FIRMWARE.md) e [docs/INTEGRACOES.md](docs/INTEGRACOES.md).

### Como atualizar

Entre como administrador e abra **Sistema → Atualização**. Clique em **Verificar agora** para ver se há versão nova no GitHub e, se houver, em **Atualizar agora**.

- Antes de baixar o código, o sistema copia o banco de dados para `backups/`. Ficam as 5 cópias mais recentes.
- Só os serviços que mudaram são reconstruídos. Mudança só em documentação não reconstrói nada.
- Quando há versão nova, um aviso aparece no topo da tela para o administrador.
- Precisa de uma instalação feita com `git clone`. Numa pasta baixada como ZIP, a atualização não funciona.

Pelo terminal, na pasta do projeto, o mesmo processo roda com `.\atualizar.ps1` (Windows) ou `sh atualizar.sh` (Linux e macOS).

## Telas

<p align="center"><img src="docs/imagens/painel-escuro.png" alt="Painel no tema escuro" width="900"></p>
<p align="center"><em>Painel inicial no tema escuro: agentes, projetos, compilações dos últimos 14 dias e atalhos.</em></p>

<p align="center"><img src="docs/imagens/agentes-llm.png" alt="Lista de agentes LLM" width="900"></p>
<p align="center"><em>Agentes LLM em cartões, com provedor, modelo, versão e menu de ações.</em></p>

<p align="center"><img src="docs/imagens/editor-agente.png" alt="Editor de agente LLM" width="900"></p>
<p align="center"><em>Editor de agente LLM: provedor, modelo, esforço, prompt de sistema e ferramentas no formato do Claude Code.</em></p>

<p align="center"><img src="docs/imagens/tinyml-config.png" alt="Configuração de agente TinyML" width="900"></p>
<p align="center"><em>Agente TinyML: entrada do sensor, classes, arquitetura, quantização e estimativa de tamanho para a placa.</em></p>

<p align="center"><img src="docs/imagens/tinyml-treino.png" alt="Treino de modelo TinyML" width="900"></p>
<p align="center"><em>Resultado de um treino: log por época, métricas, matriz de confusão e download do .tflite e do model_data.h.</em></p>

<p align="center"><img src="docs/imagens/projeto-editor.png" alt="Editor de projeto de firmware" width="900"></p>
<p align="center"><em>Projeto PlatformIO: árvore de arquivos, editor, compilação com modelo TinyML embutido e gravação.</em></p>

### Modelos

<p align="center"><img src="docs/imagens/modelos-lista.png" alt="Lista de modelos" width="900"></p>
<p align="center"><em>Área Modelos: TinyML, clássicos (scikit-learn) e ajuste fino de LLM, cada um com seus treinos e a versão publicada.</em></p>

<p align="center"><img src="docs/imagens/modelos-novo.png" alt="Assistente de novo modelo" width="900"></p>
<p align="center"><em>Assistente de criação em 3 passos: tipo, tarefa e dados, configuração.</em></p>

<p align="center"><img src="docs/imagens/modelo-treino.png" alt="Treino de modelo de imagens" width="900"></p>
<p align="center"><em>Treino de um classificador de imagens: curva de perda, matriz de confusão e log por época.</em></p>

<p align="center"><img src="docs/imagens/modelo-comparar.png" alt="Comparação de treinos" width="900"></p>
<p align="center"><em>Comparação lado a lado: parâmetros que mudaram e a melhor métrica em destaque.</em></p>

<p align="center"><img src="docs/imagens/modelo-usar.png" alt="Como usar o modelo" width="900"></p>
<p align="center"><em>Aba "Usar": código C pronto para o header gerado (aqui, uma árvore de decisão exportada para C).</em></p>

<p align="center"><img src="docs/imagens/dataset-imagens.png" alt="Dataset de imagens" width="900"></p>
<p align="center"><em>Dataset de imagens enviado como .zip, com miniaturas por classe.</em></p>

### Firmware e dados

<p align="center"><img src="docs/imagens/compilacoes.png" alt="Lista de compilações" width="900"></p>
<p align="center"><em>Histórico de compilações com status, placa e tamanho do firmware.</em></p>

<p align="center"><img src="docs/imagens/datasets.png" alt="Datasets" width="900"></p>
<p align="center"><em>Datasets em CSV com classes, amostras e prévia.</em></p>

<p align="center"><img src="docs/imagens/dispositivos.png" alt="Dispositivos" width="900"></p>
<p align="center"><em>Frota (dispositivos cadastrados), com placa, porta e última gravação.</em></p>

<p align="center"><img src="docs/imagens/integracoes.png" alt="Integrações com VS Code e Claude Code" width="900"></p>
<p align="center"><em>Passo a passo para conectar a extensão do VS Code e o MCP do Claude Code.</em></p>

<p align="center"><img src="docs/imagens/login.png" alt="Tela de login" width="900"></p>
<p align="center"><em>Tela de entrada.</em></p>

<p align="center">
  <img src="docs/imagens/painel-celular.png" alt="Painel no celular" width="280">
  &nbsp;&nbsp;
  <img src="docs/imagens/agentes-celular.png" alt="Agentes no celular" width="280">
</p>
<p align="center"><em>No celular: barra inferior com os atalhos principais e menu completo na gaveta.</em></p>

Os dados mostrados nas telas são de demonstração (criados pelo seed e pelo exemplo `exemplos/datasets/gestos.csv`).

## Placas suportadas

| Placa | Framework | Artefato gravado | Observação |
|---|---|---|---|
| ESP32 | Arduino | `firmware-merged.bin` | Gravação em `0x0` |
| ESP32-S3 | Arduino | `firmware-merged.bin` | Gravação em `0x0` |
| Arduino Nano 33 BLE | Arduino | `firmware.bin` | |
| Arduino Uno | Arduino | `firmware.hex` | |
| STM32 Nucleo F401RE | Arduino | `firmware.bin` | Gravação em `0x08000000` |
| Raspberry Pi Pico (RP2040) | Arduino | `firmware.uf2` | |

Os detalhes de cada placa, como offsets e gravação, estão em [docs/FIRMWARE.md](docs/FIRMWARE.md).

## Arquitetura

A plataforma roda em contêineres, orquestrados pelo `docker-compose.yml`:

```mermaid
flowchart LR
  navegador["Navegador<br/>(client)"] -->|"/api"| server["server<br/>Node 20 + Express"]
  vscode["VS Code / Claude Code"] -->|"/api com token aic_"| server
  placas["Placas ESP32<br/>(firmware OTA)"] -->|"/api/ota (HTTP)"| server
  placas -->|"telemetria e comandos (MQTT)"| mosquitto["mosquitto<br/>(MQTT, porta 1883)"]
  server -->|"comandos e telemetria (MQTT)"| mosquitto
  server --> db[("db<br/>PostgreSQL 16")]
  server -->|"treinos"| trainer["trainer<br/>Python + TensorFlow"]
  server -->|"compilações"| builder["builder<br/>Python + PlatformIO"]
  server -.->|"LLM local"| ollama["ollama<br/>(perfil ollama)"]
  server -.->|"ajuste fino local"| finetuner["finetuner<br/>Python + PyTorch<br/>(perfil gpu)"]
  finetuner -.->|"registra o adaptador"| ollama
  server -->|"verificar e atualizar (rede interna)"| atualizador["atualizador<br/>Node + Git + Docker (porta 4000, interna)"]
  trainer --- dados[("volume dados<br/>/data")]
  builder --- dados
  finetuner --- dados
  server --- dados
```

| Serviço | Tecnologia | Função |
|---|---|---|
| `client` | React 18, Vite, nginx | Interface web, na porta `WEB_PORT` (padrão 8080) |
| `server` | Node 20, Express, Prisma | API HTTP, autenticação, agentes, projetos, fila de trabalhos e eventos ao vivo, frota |
| `trainer` | Python 3.11, FastAPI, TensorFlow, scikit-learn | Treina os agentes e modelos TinyML e tabulares, e gera o TFLite, o `model_data.h` e o `modelo_tabular.h` |
| `finetuner` | Python 3.11, FastAPI, PyTorch, PEFT | Ajuste fino local de LLM com LoRA (só com o perfil `gpu`, exige GPU NVIDIA) |
| `builder` | Python 3.11, FastAPI, PlatformIO | Compila os projetos e grava as placas |
| `mosquitto` | Eclipse Mosquitto 2.0 | Broker MQTT da frota. Porta 1883 (`MQTT_PORTA`) publicada para as placas da rede local |
| `db` | PostgreSQL 16 | Dados da plataforma |
| `ollama` | Ollama | Modelos locais (só com o perfil `ollama`) |
| `atualizador` | Node, Git, Docker | Baixa a versão nova do GitHub e reconstrói os serviços que mudaram (pedido pela tela Atualização, só ADMIN). Sem porta publicada |

Os detalhes estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e a lista de rotas em [docs/API.md](docs/API.md).

## Início rápido

Requisitos: **Docker Desktop** e, para baixar o projeto, o **Git**.

**Windows (PowerShell):**

```powershell
git clone https://github.com/marco3079/ai-creator.git
cd ai-creator
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

**Linux e macOS (terminal):**

```bash
git clone https://github.com/marco3079/ai-creator.git
cd ai-creator
bash instalar.sh
```

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios, pergunta (se quiser) as chaves de API, sobe os contêineres e mostra o endereço do site e o login do administrador. Use `--ollama` (Linux e macOS) ou `-Ollama` (Windows) para subir também o Ollama.

**Manual:**

```bash
cp .env.example .env        # troque POSTGRES_PASSWORD, JWT_SECRET e INTERNO_TOKEN
docker compose up -d --build
```

Para um passo a passo sem termos técnicos, veja [INSTALAR.md](INSTALAR.md).

### Instalar com um assistente de IA

Se você usa um assistente com acesso ao terminal (Claude Code ou outro), cole este texto nele:

> Instale o AI Creator do repositório https://github.com/marco3079/ai-creator neste computador seguindo o arquivo AGENTS.md do repositório. Ao terminar, me diga o endereço para abrir no navegador e o e-mail e a senha do administrador.

As instruções para o assistente estão em [AGENTS.md](AGENTS.md).

## Primeiro acesso

Na primeira subida, o sistema cria a conta do administrador com o e-mail de `ADMIN_EMAIL` e a senha de `ADMIN_SENHA`.

Os valores padrão são:

- **E-mail:** `admin@aicreator.local`
- **Senha:** `trocar123`

Entre no endereço do site (por padrão `http://localhost:8080`). Se a senha ainda for a padrão (`ADMIN_SENHA` não foi definido), o sistema pede a troca da senha antes de liberar as outras telas.

## Configuração

O arquivo `.env` na raiz é lido pelo Docker Compose. O instalador cria esse arquivo; para ajustar à mão, copie o `.env.example`.

| Variável | Padrão | Para que serve |
|---|---|---|
| `POSTGRES_PASSWORD` | `aicreator` | Senha do banco de dados |
| `JWT_SECRET` | `troque-este-segredo` | Segredo que assina os logins |
| `INTERNO_TOKEN` | `troque-token-interno` | Token que trainer e builder usam para chamar o servidor |
| `ADMIN_EMAIL` | `admin@aicreator.local` | E-mail da conta de administrador |
| `ADMIN_SENHA` | `trocar123` | Senha inicial do administrador |
| `ANTHROPIC_API_KEY` | vazio | Chave da API da Anthropic (agentes com provedor Claude) |
| `OPENAI_API_KEY` | vazio | Chave da API da OpenAI (agentes com provedor OpenAI) |
| `WEB_PORT` | `8080` | Porta do site no computador |
| `MQTT_USUARIO` | `aic` | Usuário do broker MQTT das placas |
| `MQTT_SENHA` | `troque-senha-mqtt` | Senha do broker MQTT (o instalador gera uma aleatória) |
| `MQTT_PORTA` | `1883` | Porta do MQTT publicada no computador, para as placas da rede local |
| `MQTT_HOST_PUBLICO` | vazio | Endereço que as placas usam para chegar ao MQTT (por exemplo, o IP da máquina na rede) |
| `SERVIDOR_URL_PUBLICA` | vazio | Endereço que as placas usam para chegar ao servidor (por exemplo, `http://192.168.0.10:8080`) |

Os valores padrão servem para teste. O instalador gera segredos aleatórios no `.env`. Não envie o `.env` para o Git: ele já está no `.gitignore`.

Se `JWT_SECRET` ou `INTERNO_TOKEN` ficarem com o valor de exemplo, o servidor gera um segredo e o grava em `dados/segredos.json` (no Docker, `/data/segredos.json`). Assim os logins continuam válidos depois de reiniciar.

Os agentes Ollama usam o modelo que estiver instalado no servidor Ollama local, que sobe com `--ollama` ou com `--profile ollama`.

## Integrações

- **VS Code**: extensão que mostra os agentes e projetos da plataforma e permite baixar, enviar, compilar e gravar a placa. Veja [docs/INTEGRACOES.md](docs/INTEGRACOES.md).
- **Claude Code**: servidor MCP e plugin, para listar e editar agentes e arquivos, compilar e treinar sem sair do chat. Veja [docs/INTEGRACOES.md](docs/INTEGRACOES.md). O modelo de configuração está em [.mcp.json.exemplo](.mcp.json.exemplo).
- **API HTTP**: qualquer cliente pode usar a API com um token de API (`aic_...`). Veja [docs/API.md](docs/API.md).

## Estrutura de pastas

```
ai-creator/
  docker-compose.yml          serviços, volumes e portas
  .env.example                modelo de configuração
  instalar.sh / instalar.ps1  instaladores (Linux/macOS e Windows)
  atualizar.sh / atualizar.ps1 atualização pelo terminal (Linux/macOS e Windows)
  atualizador/                serviço que atualiza o sistema pela tela (Node, Git, Docker)
  server/                     API (Node 20, TypeScript, Express, Prisma)
  client/                     interface web (React, TypeScript, Vite)
  trainer/                    treino TinyML e tabular (Python, FastAPI, TensorFlow, scikit-learn)
  finetuner/                  ajuste fino local de LLM (Python, FastAPI, PyTorch; perfil gpu)
  builder/                    compilação e gravação (Python, FastAPI, PlatformIO)
  extensions/vscode/          extensão do VS Code
  integrations/claude-code/   plugin e servidor MCP do Claude Code
  docs/                       documentação técnica
```

## Desenvolvimento

Para desenvolver sem os contêineres de aplicação, suba só o banco e rode o servidor e o cliente com Node.js 20:

```bash
# 1) banco (PostgreSQL publicado só em 127.0.0.1, na porta 5432)
docker compose up -d db

# 2) servidor
cd server
npm install
npm run dev

# 3) cliente
cd ../client
npm install
npm run dev
```

Com o cliente em modo de desenvolvimento, abra `http://localhost:5173`. O Vite encaminha `/api` para o servidor em `http://localhost:3333`.

Para o treino e a compilação, use o Compose só para os serviços de Python, com o servidor rodando à parte: `docker compose up -d --build trainer builder`. Lembre que o servidor local usa a porta 3333 e o `server` do Compose não é publicado.

Verificações antes de enviar uma mudança:

```bash
cd server && npx tsc --noEmit
cd server && npm test     # precisa de DATABASE_URL apontando para um PostgreSQL de teste
cd client && npx tsc --noEmit && npm run build
docker compose config -q
```

## Roadmap

As próximas ideias, com prioridade (curto, médio e longo prazo), estão em [docs/SUGESTOES.md](docs/SUGESTOES.md).

## Contribuindo

Sugestões e correções são bem-vindas. Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Segurança

Para relatar uma vulnerabilidade, siga as instruções em [SECURITY.md](SECURITY.md).

## Licença

Este projeto é distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE).
