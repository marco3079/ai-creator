# API HTTP

Referência das rotas do servidor. Todas ficam sob o prefixo `/api`, usam JSON e devolvem erros no formato:

```json
{ "erro": "mensagem em português" }
```

## Autenticação

Toda rota, salvo as marcadas como públicas, exige um destes cabeçalhos:

- `Authorization: Bearer <jwt>`: token de login, válido por 12 horas. Obtido em `POST /api/auth/login`.
- `Authorization: Bearer aic_<token>`: token de API, criado em **Tokens de API** ou em `POST /api/tokens`. É o que usam a extensão do VS Code e o servidor MCP.

As rotas `/api/interno/*` não usam JWT. Exigem o cabeçalho `X-Interno-Token` com o valor de `INTERNO_TOKEN`, e são chamadas só pelos serviços `trainer` e `builder`.

## Perfis

| Perfil | Permissões |
|---|---|
| `ADMIN` | Tudo, inclusive usuários, logs e configurações da plataforma |
| `DEV` | Cria, edita e executa agentes, treinos, projetos e compilações |
| `LEITOR` | Só consulta (GET) |

Toda rota de escrita exige `ADMIN` ou `DEV`, salvo quando a tabela indicar outra regra.

## Convenções

- `id` pode ser o número ou o slug, nas rotas que indicam `(id ou slug)`.
- Respostas de criação devolvem o objeto criado. Remoções devolvem `204` sem corpo.
- Corpo de requisição: `application/json`, com limite de 25 MB.

---

## Sistema

### Autenticação (`/api/auth`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/auth/login` | público | Corpo `{ email, senha }`. Devolve `{ token, usuario }` |
| POST | `/auth/sair` | logado | Encerra a sessão. Devolve `204` |
| GET | `/auth/eu` | logado | Devolve `{ usuario }` |

`UsuarioPublico = { id, nome, email, perfil }`.

### Usuários (`/api/usuarios`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/usuarios` | ADMIN | Lista usuários: `UsuarioPublico & { ativo, criadoEm }[]` |
| POST | `/usuarios` | ADMIN | Corpo `{ nome, email, senha, perfil }` |
| PUT | `/usuarios/:id` | ADMIN | Corpo parcial `{ nome?, email?, senha?, perfil?, ativo? }` |
| DELETE | `/usuarios/:id` | ADMIN | Remove o usuário. Não permite remover a própria conta. `204` |

### Tokens de API (`/api/tokens`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/tokens` | logado | Lista os tokens do próprio usuário: `{ id, nome, prefixo, criadoEm, ultimoUso, revogado }[]` |
| POST | `/tokens` | DEV, ADMIN | Corpo `{ nome }`. Devolve `{ token, registro }`, com `token = "aic_<40 hex>"` |
| DELETE | `/tokens/:id` | DEV, ADMIN | Revoga o token (marca como revogado). `204` |

O valor de `token` aparece só nessa resposta. Guarde-o na hora.

### Plataforma (`/api/plataforma`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/plataforma` | público | Devolve `{ nome, slogan, corPrimaria }` |
| PUT | `/plataforma` | ADMIN | Altera nome, slogan e cor principal |

### Logs (`/api/logs`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/logs` | ADMIN | Últimos 200 registros: `{ id, acao, detalhe, criadoEm, usuario: { id, nome } \| null }[]` |

### Saúde (`/api/saude`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/saude` | público | Devolve `{ "ok": true }`. Usado pelo healthcheck do Compose |

### Painel (`/api/painel`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/painel` | logado | Indicadores, gráfico e atividade recente |

Resposta:

```json
{
  "contagens": { "agentesLlm": 0, "agentesTinyml": 0, "projetos": 0, "dispositivos": 0, "treinosSucesso": 0, "buildsSucesso": 0 },
  "buildsPorDia": [{ "dia": "2026-11-11", "sucesso": 0, "falha": 0 }],
  "recentes": [{ "tipo": "BUILD", "id": 1, "titulo": "Blink ESP32", "status": "SUCESSO", "criadoEm": "2026-11-11T12:00:00.000Z" }],
  "destaque": null
}
```

`buildsPorDia` tem 14 dias, incluindo os dias sem atividade. `recentes` tem 6 itens. `destaque` é o agente atualizado por último, ou `null`.

---

## Agentes e LLM

### Agentes (`/api/agentes`)

`AgenteResumo = { id, nome, slug, descricao, tipo, tags, provedor, modelo, versao, atualizadoEm, projeto: { id, nome } | null }`

`Agente = AgenteResumo & { promptSistema, esforco, temperatura, maxTokens, ferramentas, configTinyml, projetoId, criadoEm }`

`tipo` é `LLM` ou `TINYML`. Para `TINYML`, o campo `configTinyml` segue o formato de [TINYML.md](TINYML.md).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/agentes?tipo=LLM\|TINYML&busca=texto` | logado | Lista `AgenteResumo[]`, da mais recente para a mais antiga |
| GET | `/agentes/:id` | logado | Devolve o `Agente` completo (id ou slug) |
| POST | `/agentes` | DEV, ADMIN | Cria o agente e a versão 1 ("Criação") |
| PUT | `/agentes/:id` | DEV, ADMIN | Atualização parcial, com `nota?`. Gera nova versão com o snapshot completo |
| DELETE | `/agentes/:id` | DEV, ADMIN | Remove o agente. `204` |
| POST | `/agentes/:id/duplicar` | DEV, ADMIN | Cria uma cópia com o nome `<nome> (cópia)` |

Exemplo de criação de um agente LLM:

```bash
curl -X POST http://localhost:8080/api/agentes \
  -H "Authorization: Bearer aic_seu_token" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Revisor de código",
    "descricao": "Revisa diffs e aponta problemas",
    "tipo": "LLM",
    "provedor": "ANTHROPIC",
    "modelo": "claude-sonnet-5-5",
    "promptSistema": "Você revisa código em português, apontando bugs e riscos.",
    "ferramentas": ["Read", "Grep", "Glob"]
  }'
```

### Versões (`/api/agentes/:id/versoes`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/agentes/:id/versoes` | logado | Lista `{ versao, nota, criadoEm }[]` |
| GET | `/agentes/:id/versoes/:versao` | logado | Devolve `{ versao, nota, criadoEm, snapshot }` |
| POST | `/agentes/:id/versoes/:versao/restaurar` | DEV, ADMIN | Restaura a versão. Cria nova versão "Restaurado da vN" e devolve o `Agente` |

### Import e export

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/agentes/:id/exportar?formato=md\|json` | logado | Exporta como texto. `md` só para LLM |
| POST | `/agentes/importar` | DEV, ADMIN | Corpo `{ conteudo, formato: "md" \| "json" }`. Se já existir agente com o mesmo slug, atualiza e cria nova versão ("Importado") |

O formato `md` é o de subagente do Claude Code:

```
---
name: revisor-de-codigo
description: Revisa diffs e aponta problemas
model: sonnet
tools: Read, Grep, Glob
---

Você revisa código em português, apontando bugs e riscos.
```

Na importação, `model` vira o modelo padrão do provedor: `opus` gera `claude-opus-5-5`, `sonnet` gera `claude-sonnet-5-5`, `haiku` gera `claude-haiku-5-5`, e `inherit` ou ausente gera `claude-opus-5-5`.

Exemplo de exportação:

```bash
curl -H "Authorization: Bearer aic_seu_token" \
  "http://localhost:8080/api/agentes/revisor-de-codigo/exportar?formato=md" \
  -o .claude/agents/revisor-de-codigo.md
```

### Execução (SSE)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/agentes/:id/executar` | DEV, ADMIN | Executa um agente LLM com streaming. Corpo `{ mensagens: MensagemChat[] }` |

A resposta é `text/event-stream`. Cada evento é uma linha `data: <json>` seguida de linha em branco:

- `{"tipo":"texto","texto":"..."}`: trecho da resposta;
- `{"tipo":"fim","uso":{"entrada":123,"saida":456}}`: fim, com o uso de tokens;
- `{"tipo":"erro","erro":"mensagem"}`: falha no provedor.

Se o cliente desconectar, o servidor cancela a chamada ao provedor.

```bash
curl -N -X POST http://localhost:8080/api/agentes/1/executar \
  -H "Authorization: Bearer aic_seu_token" \
  -H "Content-Type: application/json" \
  -d '{"mensagens":[{"papel":"usuario","texto":"Olá"}]}'
```

### Conversas

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/agentes/:id/conversas` | logado | Lista `{ id, titulo, atualizadoEm }[]` |
| POST | `/agentes/:id/conversas` | DEV, ADMIN | Corpo `{ titulo, mensagens }`. Devolve a conversa |
| GET | `/conversas/:id` | logado | Devolve `{ id, titulo, mensagens }` |
| PUT | `/conversas/:id` | DEV, ADMIN | Corpo `{ mensagens }` |
| DELETE | `/conversas/:id` | DEV, ADMIN | Remove a conversa. `204` |

### Provedores (`/api/llm`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/llm/modelos` | logado | `{ ANTHROPIC: string[], OPENAI: string[], OLLAMA: string[] }`. Os modelos do Ollama vêm de `OLLAMA_URL/api/tags`, com tempo limite de 2 s, e voltam `[]` se falhar |
| GET | `/llm/status` | logado | `{ ANTHROPIC: boolean, OPENAI: boolean, OLLAMA: boolean }`. Diz se a chave está configurada ou se o Ollama respondeu |

---

## Dados e treinos (TinyML)

### Datasets (`/api/datasets`)

O CSV tem cabeçalho `rotulo,f0,f1,...,fN`. Cada linha seguinte tem o rótulo (texto) e N números. Para `SERIE_TEMPORAL`, a janela vem achatada, amostra por amostra: `ax0,ay0,az0,ax1,...`. Detalhes em [TINYML.md](TINYML.md).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/datasets` | logado | Lista `{ id, nome, descricao, tipo, classes, janela, amostras, colunas, criadoEm }[]` |
| POST | `/datasets` | DEV, ADMIN | Corpo `{ nome, descricao?, tipo, janela?, csv }`. Valida o CSV, calcula classes, amostras e colunas, e grava em `/data/datasets/<id>.csv` |
| DELETE | `/datasets/:id` | DEV, ADMIN | Remove o dataset. `204` |
| GET | `/datasets/:id/amostra` | logado | Devolve as 20 primeiras linhas: `{ cabecalho: string[], linhas: string[][] }` |
| GET | `/datasets/:id/csv` | logado | Baixa o CSV |

### Treinos (`/api/treinos`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/agentes/:id/treinar` | DEV, ADMIN | Só TinyML. Corpo `{ datasetId, parametros?: Partial<ConfigTinyml> }`. Cria o treino na fila, envia ao `trainer` e muda para EXECUTANDO. Devolve `Treino` |
| GET | `/treinos?agenteId=` | logado | Lista `{ id, agenteId, datasetId, status, metricas, tamanhoBytes, criadoEm, finalizadoEm }[]` |
| GET | `/treinos/:id` | logado | Devolve o treino completo, com `log` |
| GET | `/treinos/:id/modelo.tflite` | logado | Baixa o modelo TFLite |
| GET | `/treinos/:id/model_data.h` | logado | Baixa o arquivo C `model_data.h` |

Os downloads exigem o token no cabeçalho. Para baixar pelo navegador, use `fetch` com o token e `URL.createObjectURL`.

---

## Firmware

### Projetos (`/api/projetos`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/projetos` | logado | Lista `{ id, nome, slug, descricao, placa, framework, atualizadoEm, totalArquivos, ultimoBuild }[]` |
| POST | `/projetos` | DEV, ADMIN | Corpo `{ nome, descricao?, placa }`. Cria o projeto com os arquivos-modelo da placa |
| GET | `/projetos/:id` | logado | Devolve o projeto com `arquivos: { caminho, atualizadoEm }[]` |
| PUT | `/projetos/:id` | DEV, ADMIN | Corpo parcial `{ nome?, descricao?, placa? }`. Trocar a placa reescreve só o `platformio.ini` |
| DELETE | `/projetos/:id` | DEV, ADMIN | Remove o projeto. `204` |

### Arquivos do projeto

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/projetos/:id/arquivos?conteudo=1` | logado | Lista `{ caminho, atualizadoEm, conteudo? }[]`. O `conteudo` vem só com `conteudo=1` |
| PUT | `/projetos/:id/arquivos` | DEV, ADMIN | Grava em lote: `{ arquivos: [{ caminho, conteudo }], removerAusentes? }`. `204` |
| GET | `/projetos/:id/arquivo?caminho=src/main.cpp` | logado | Devolve `{ caminho, conteudo }` |
| PUT | `/projetos/:id/arquivo` | DEV, ADMIN | Corpo `{ caminho, conteudo }`. `204` |
| DELETE | `/projetos/:id/arquivo?caminho=` | DEV, ADMIN | Remove um arquivo. `204` |

Caminhos com `..`, barra invertida (`\`) ou caminho absoluto devolvem `400`.

### Compilações (`/api/builds`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/projetos/:id/build` | DEV, ADMIN | Corpo `{ agenteId? }`. Grava os arquivos em `/data/projetos/<slug>/`, copia o `model_data.h` do agente (se houver treino) para `include/`, envia ao `builder` e muda para EXECUTANDO. Devolve `Build` |
| GET | `/builds?projetoId=` | logado | Lista `{ id, projetoId, placa, status, tamanhoBytes, offset, criadoEm, finalizadoEm }[]` |
| GET | `/builds/:id` | logado | Devolve a compilação completa, com `log` |
| GET | `/builds/:id/firmware` | logado | Baixa o firmware gerado |
| POST | `/builds/:id/gravar` | DEV, ADMIN | Corpo `{ porta }`. Repassa ao `builder` e devolve `{ ok, log }`. Só funciona no Linux, com a USB mapeada |

### Dispositivos (`/api/dispositivos`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/dispositivos` | logado | Lista os dispositivos |
| POST | `/dispositivos` | DEV, ADMIN | Corpo `{ nome, placa, porta?, notas? }` |
| PUT | `/dispositivos/:id` | DEV, ADMIN | Atualização parcial |
| DELETE | `/dispositivos/:id` | DEV, ADMIN | Remove o dispositivo. `204` |

---

## Rotas internas

Usadas só pelos serviços da plataforma. Exigem `X-Interno-Token`.

| Método | Rota | Quem chama | Descrição |
|---|---|---|---|
| POST | `/interno/treinos/:id` | `trainer` | Atualiza o treino: `{ status, log?, metricas?, modeloTflite?, modeloH?, tamanhoBytes? }`. Em SUCESSO grava `ultimoTreinoId` no agente. `204` |
| POST | `/interno/builds/:id` | `builder` | Atualiza a compilação: `{ status, log?, artefato?, offset?, tamanhoBytes? }`. `204` |

Status possíveis: `FILA`, `EXECUTANDO`, `SUCESSO`, `FALHA` e `CANCELADO`.

---

## Exemplos rápidos

Login e uso do token de login:

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aicreator.local","senha":"trocar123"}'
```

Compilar um projeto:

```bash
curl -X POST http://localhost:8080/api/projetos/blink-esp32/build \
  -H "Authorization: Bearer aic_seu_token" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Depois, consulte `GET /api/builds/<id>` até o status virar `SUCESSO` ou `FALHA`.
