# Arquitetura

Este documento descreve os serviços da plataforma, os fluxos principais e as convenções de código. A lista de rotas está em [API.md](API.md).

## Serviços

```mermaid
flowchart TB
  subgraph Navegador
    client["client<br/>React + Vite, servido por nginx (porta 80)"]
  end
  subgraph Integracoes
    vscode["Extensão VS Code"]
    mcp["Servidor MCP (Claude Code)"]
  end
  subgraph Compose["docker compose"]
    server["server<br/>Express + Prisma (3333)"]
    trainer["trainer<br/>FastAPI + TensorFlow (8001)"]
    builder["builder<br/>FastAPI + PlatformIO (8002)"]
    finetuner["finetuner<br/>FastAPI + PyTorch (8003, perfil gpu)"]
    db[("db<br/>PostgreSQL 16 (5432)")]
    ollama["ollama<br/>(perfil ollama, 11434)"]
    dados[("volume dados<br/>/data")]
    hf[("volume hf<br/>cache do Hugging Face")]
  end
  subgraph Nuvem["API da OpenAI"]
    openai["ajuste fino (jobs)"]
  end
  client -->|"/api"| server
  vscode -->|"/api, token aic_"| server
  mcp -->|"/api, token aic_"| server
  server --> db
  server -->|"POST /treinos e /modelos/treinos"| trainer
  server -->|"POST /builds, /gravar"| builder
  server -->|"POST /treinos (LLM local)"| finetuner
  server -->|"ajuste fino (LLM nuvem)"| openai
  server -->|"/api/tags"| ollama
  trainer -->|"callback /api/interno/treinos e /treinos-modelo"| server
  builder -->|"callback /api/interno/builds"| server
  finetuner -->|"callback /api/interno/treinos-modelo"| server
  finetuner -->|"/api/create"| ollama
  server -->|"GET jobs a cada 30 s"| openai
  server --- dados
  trainer --- dados
  builder --- dados
  finetuner --- dados
  finetuner --- hf
```

| Serviço | Pasta | Tecnologia | Porta interna | Exposto no computador |
|---|---|---|---|---|
| `db` | (imagem) | PostgreSQL 16 | 5432 | não |
| `server` | `server/` | Node 20, Express 4, Prisma 5, TypeScript, `tsx` | 3333 | não |
| `client` | `client/` | React 18, Vite 5, TypeScript, nginx | 80 | sim, `WEB_PORT` (padrão 8080) |
| `trainer` | `trainer/` | Python 3.11, FastAPI, TensorFlow CPU, scikit-learn | 8001 | não |
| `builder` | `builder/` | Python 3.11, FastAPI, PlatformIO | 8002 | não |
| `finetuner` | `finetuner/` | Python 3.11, FastAPI, PyTorch CUDA, Transformers, PEFT, TRL | 8003 | não (perfil `gpu`, exige GPU NVIDIA) |
| `ollama` | (imagem `ollama/ollama`) | Ollama | 11434 | não (perfil `ollama`) |

Só o `client` é publicado. O `server` conversa com a extensão, com o MCP e com o navegador pelo `client`, que encaminha `/api`. Os serviços internos não têm porta publicada.

## Volumes

| Volume | Montado em | Quem usa | Conteúdo |
|---|---|---|---|
| `dados_db` | `/var/lib/postgresql/data` (db) | db | Dados do PostgreSQL |
| `dados` | `/data` | server, trainer, builder | Arquivos da plataforma |
| `platformio` | `/root/.platformio` | builder | Plataformas e bibliotecas do PlatformIO, para não baixar a cada compilação |
| `ollama` | `/root/.ollama` | ollama | Modelos locais |
| `hf` | `/root/.cache/huggingface` | finetuner | Modelos base baixados do Hugging Face, para não baixar a cada treino |

Dentro do volume `dados` (`/data`):

```
/data/
  datasets/<id>.csv                 CSV enviados
  datasets/<id>.jsonl               conversas enviadas (modelos LLM)
  datasets/<id>/                    imagens extraídas do .zip (datasets IMAGENS)
  treinos/<id>/                     modelo.tflite, model_data.h e log do treino (agentes TinyML)
  modelos/<modeloId>/treinos/<n>/   artefatos de cada treino de modelo (model.tflite, modelo.joblib, adapter_model.safetensors etc.)
  projetos/<slug>/                  arquivos do projeto PlatformIO
  builds/<id>/                      firmware gerado (firmware-merged.bin, firmware.bin etc.)
```

Os caminhos do servidor são relativos a `DATA_DIR`, que vale `/data` no Compose. Trainer e builder recebem só `DATA_DIR=/data`.

## Fluxo de treino TinyML

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant C as client
  participant S as server
  participant T as trainer
  U->>C: Treinar o agente com um dataset
  C->>S: POST /api/agentes/:id/treinar
  S->>S: Cria o Treino (FILA)
  S->>T: POST /treinos (csv, config, callbackUrl, callbackToken)
  T-->>S: 202 Accepted
  S->>S: Treino passa para EXECUTANDO
  T->>S: POST /api/interno/treinos/:id (EXECUTANDO)
  Note over T: Treina em segundo plano com Keras
  Note over T: Converte para TFLite INT8 e gera model_data.h
  T->>S: POST /api/interno/treinos/:id (SUCESSO, metricas, modelo, log)
  S->>S: Grava ultimoTreinoId no agente
  C->>S: GET /api/treinos/:id (polling a cada 3 s)
  S-->>C: Status, métricas e log
```

Se o treino falhar, o `trainer` envia `FALHA` com o log. O servidor não grava `ultimoTreinoId` nesse caso.

## Fluxo de compilação e gravação

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant C as client
  participant S as server
  participant B as builder
  U->>C: Compilar o projeto
  C->>S: POST /api/projetos/:id/build { agenteId? }
  S->>S: Escreve os arquivos em /data/projetos/<slug>/
  S->>S: Se houver agente com treino, copia model_data.h para include/
  S->>B: POST /builds (buildId, projetoDir, placa, saidaDir, callback)
  B-->>S: 202 Accepted
  S->>S: Build passa para EXECUTANDO
  Note over B: pio run -d <projetoDir>
  Note over B: Copia o artefato da placa para /data/builds/<id>/
  B->>S: POST /api/interno/builds/:id (SUCESSO, artefato, offset, log)
  U->>C: Baixar firmware ou gravar pelo servidor
  C->>S: GET /api/builds/:id/firmware
  C->>S: POST /api/builds/:id/gravar { porta } (Linux, USB mapeada)
  S->>B: POST /gravar { artefato, placa, porta, offset }
  B-->>S: { ok, log }
  S-->>C: { ok, log }
```

A gravação pelo navegador (Web Serial) não passa pelo servidor. O detalhe está em [FIRMWARE.md](FIRMWARE.md).

## Fluxos de treino de modelos

A área **Modelos** tem três caminhos de treino, escolhidos pelo tipo do modelo. Em todos, o servidor cria um `TreinoModelo` (com um `numero` por modelo) e acompanha o resultado por callback.

### Treino TinyML e tabular (trainer)

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant C as client
  participant S as server
  participant T as trainer
  U->>C: Treinar o modelo com um dataset
  C->>S: POST /api/modelos/:id/treinar
  S->>S: Cria o TreinoModelo (FILA)
  S->>T: POST /modelos/treinos (tipo, tarefa, dataset, saidaDir, config, callback)
  T-->>S: 202 Accepted
  S->>S: Treino passa para EXECUTANDO
  T->>S: POST /api/interno/treinos-modelo/:id (log em blocos, por época ou etapa)
  Note over T: Roda em processo filho (sklearn ou Keras)
  T->>S: POST /api/interno/treinos-modelo/:id (SUCESSO, metricas, artefatos)
  C->>S: GET /api/treinos-modelo/:id (polling)
  S-->>C: Status, métricas e log
```

Se o processo filho morrer sem enviar o callback final, o servidor grava FALHA com o motivo.

### Ajuste fino na OpenAI (worker)

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant C as client
  participant S as server
  participant O as OpenAI
  U->>C: Treinar modelo LLM na nuvem
  C->>S: POST /api/modelos/:id/treinar
  S->>O: POST /v1/files (JSONL, purpose fine-tune)
  S->>O: POST /v1/fine_tuning/jobs
  S->>S: Treino passa para EXECUTANDO e grava externoId
  loop a cada 30 segundos (worker)
    S->>O: GET /v1/fine_tuning/jobs/:id e /events
    O-->>S: Status, eventos novos e métricas
    S->>S: Acrescenta eventos ao log e ao histórico
  end
  S->>S: succeeded vira SUCESSO com modeloResultante ft:...
  Note over S: Cancelar chama POST /v1/fine_tuning/jobs/:id/cancel
```

O worker roda dentro do próprio servidor, com proteção contra execuções sobrepostas. Falhas de rede são registradas no log e não derrubam o servidor.

### Ajuste fino local (finetuner e Ollama)

```mermaid
sequenceDiagram
  autonumber
  participant S as server
  participant F as finetuner
  participant G as GPU
  participant L as ollama
  S->>F: POST /treinos (dataset JSONL, config, nomeOllama, callback)
  F-->>S: 202 Accepted
  F->>S: POST /api/interno/treinos-modelo/:id (EXECUTANDO)
  F->>G: LoRA (PEFT) com SFTTrainer, log por passo
  F->>S: POST /api/interno/treinos-modelo/:id (log e metricas)
  F->>L: POST /api/pull (modelo base)
  F->>L: POST /api/blobs/sha256:... (adaptador e configuração)
  F->>L: POST /api/create (base + adaptadores, nomeOllama)
  F->>S: POST /api/interno/treinos-modelo/:id (SUCESSO, modeloResultante)
```

Se o Ollama não responder, o treino termina em SUCESSO com um aviso no log e sem `modeloResultante`. Assim o adaptador continua disponível para baixar.

## Autenticação

Há dois tipos de credencial, aceitos no mesmo cabeçalho `Authorization: Bearer`:

- **JWT** (`jwt`): emitido no login, válido por 12 horas. O servidor recarrega o usuário no banco a cada requisição e recusa usuários inativos.
- **Token de API** (`aic_<40 hex>`): criado pelo usuário em **Tokens de API**. O servidor guarda só o hash SHA-256 e um prefixo para exibição. Um token revogado deixa de funcionar na hora. Quando usado, `ultimoUso` é atualizado.

O perfil (`ADMIN`, `DEV` ou `LEITOR`) define quais rotas a credencial pode usar. As rotas `/api/interno/*` usam outro segredo, `INTERNO_TOKEN`, enviado no cabeçalho `X-Interno-Token`.

Senhas são guardadas com bcrypt.

## Convenção de módulos

### Servidor

- Cada módulo fica em `server/src/modules/<modulo>/routes.ts` e exporta `export default router` (um `express.Router()`).
- As rotas são declaradas com o caminho completo, sem `/api` (por exemplo, `router.get('/agentes', ...)`).
- Na inicialização, `app.ts` lê a pasta `src/modules` e monta cada `router` em `/api`. Para criar um módulo, basta criar a pasta com o `routes.ts`.
- Código comum fica em `server/src/lib/`: `prisma.ts`, `config.ts`, `erros.ts` (classe `ErroHttp` e o wrapper `rota`), `auth.ts` (autenticação e perfis), `log.ts` (registro de atividades), `slug.ts` e `arquivos.ts`.
- Validação de entrada com zod. Erros são convertidos pelo tratador de `app.ts`: `ErroHttp` vira o status informado, erro de validação vira `400` com a primeira mensagem, e o resto vira `500 "Erro interno"`.

### Cliente

- Cada módulo fica em `client/src/modules/<modulo>/index.tsx` e exporta `export const rotas: RotaModulo[]`. O `App.tsx` junta os módulos com `import.meta.glob`.
- Componentes visuais ficam em `client/src/ui/index.tsx`, e o menu de ações em `client/src/ui/MenuAcoes.tsx`.
- Os tipos compartilhados com a API ficam em `client/src/lib/tipos-api.ts`.
- Chamadas HTTP passam por `api.get/post/put/del` e por `useDados<T>(caminho)`. Para SSE, use `lerEventos` de `client/src/lib/sse.ts`.
- Cores só por variáveis CSS do tema.

## Banco de dados

O esquema fica em `server/prisma/schema.prisma`. Ao subir, o servidor aplica o esquema com `prisma db push` e roda o seed, que cria o administrador. A configuração de cada agente TinyML é guardada como JSON no campo `configTinyml` (formato em [TINYML.md](TINYML.md)).

Cada alteração de agente gera uma linha em `VersaoAgente` com o snapshot completo. Por isso o histórico de versões funciona sem tabela de diferenças.

## Serviços externos

- **Anthropic**: SDK oficial, com a chave `ANTHROPIC_API_KEY`.
- **OpenAI**: chave `OPENAI_API_KEY`.
- **Ollama**: `OLLAMA_URL` (padrão `http://ollama:11434`). Os modelos são listados em `/api/tags`.
- **PlatformIO**: dentro do `builder`, com o registro de plataformas no volume `platformio`.

Se um provedor não tiver chave ou não responder, a API devolve erro em português e a interface mostra o aviso, sem derrubar o restante do sistema.
