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
- Corpo de requisição: `application/json`, com limite de 25 MB. A exceção é o envio de arquivos de dataset (`POST /datasets/arquivo`), que aceita até 200 MB em corpo binário.

---

## Sistema

### Autenticação (`/api/auth`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/auth/login` | público | Corpo `{ email, senha }`. Devolve `{ token, usuario }` |
| POST | `/auth/sair` | logado | Encerra a sessão. Devolve `204` |
| GET | `/auth/eu` | logado | Devolve `{ usuario }` |
| POST | `/auth/trocar-senha` | logado | Corpo `{ senhaAtual, novaSenha }`. A nova senha tem no mínimo 8 caracteres e precisa ser diferente da atual e do e-mail. Devolve `{ token, usuario }` com `trocarSenha: false` |

`UsuarioPublico = { id, nome, email, perfil, trocarSenha }`. `trocarSenha` é `true` quando o usuário precisa trocar a senha antes de usar o sistema. Isso acontece com a senha padrão do administrador e quando outro administrador redefine a senha. Enquanto for `true`, a interface só libera a tela de troca de senha.

### Usuários (`/api/usuarios`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/usuarios` | ADMIN | Lista usuários: `UsuarioPublico & { ativo, criadoEm }[]` |
| POST | `/usuarios` | ADMIN | Corpo `{ nome, email, senha, perfil }`. O novo usuário sai com `trocarSenha: true` |
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

### Fila e eventos ao vivo

Treinos e compilações entram numa fila no banco e são enviados pelo despachante (veja [ARQUITETURA.md](ARQUITETURA.md)).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/fila` | logado | Situação por serviço: `{ servicos: { nome, capacidade, executando, naFila, online }[] }`. Os serviços são `trainer`, `builder`, `finetuner` e `openai` |
| GET | `/eventos` | logado | Stream SSE (`text/event-stream`) dos eventos dos trabalhos e da frota |

Cada evento é uma linha `data: <json>`, seguida de linha em branco. O JSON tem `tipo` (`treino`, `treinoModelo`, `build` ou `dispositivo`), `id`, `status` (nos trabalhos), o id do agente, do modelo ou do projeto, e `em` (ISO). A conexão recebe `: ping` a cada 25 segundos.

```
data: {"tipo":"build","id":12,"status":"SUCESSO","projetoId":3,"em":"2026-11-16T12:00:00.000Z"}
```

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
- `{"tipo":"ferramenta","id":"...","nome":"aic.compilar","entrada":"...","fase":"inicio"}` e, depois, `{"tipo":"ferramenta","id":"...","nome":"aic.compilar","resultado":"...","erro":false,"fase":"fim"}`: chamada de ferramenta da plataforma (só com ferramentas ligadas);
- `{"tipo":"fim","uso":{"entrada":123,"saida":456,"custoUsd":0.0012}}`: fim, com o uso de tokens e o custo estimado em dólares (`custoUsd` é `null` quando o modelo não tem preço);
- `{"tipo":"erro","erro":"mensagem"}`: falha no provedor.

O evento `fim` vem em toda execução, com ou sem ferramentas. Com ferramentas ligadas, o agente precisa ter `projetoId` e ferramentas `aic.*` marcadas; o Ollama roda sem ferramentas e avisa com um evento `texto`. Detalhes em [INTEGRACOES.md](INTEGRACOES.md).

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

### Uso e custos (`/api/uso`)

Cada execução de agente é registrada com os tokens de entrada e saída e o custo estimado. Os preços vêm de uma tabela padrão da plataforma (USD por 1 milhão de tokens), que a plataforma pode sobrescrever. Modelos do Ollama custam zero.

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/uso/resumo?dias=30` | logado | Totais do período (de 1 a 365 dias, padrão 30), por dia, por agente e por modelo |
| GET | `/uso/precos` | logado | Devolve `{ padrao, personalizados }`, os preços por modelo |
| PUT | `/uso/precos` | ADMIN | Corpo `{ precos }`. Sobrescreve ou acrescenta preços de modelos |

---

## Dados e treinos (TinyML)

### Datasets (`/api/datasets`)

O CSV tem cabeçalho `rotulo,f0,f1,...,fN`. Cada linha seguinte tem o rótulo (texto) e N números. Para `SERIE_TEMPORAL`, a janela vem achatada, amostra por amostra: `ax0,ay0,az0,ax1,...`. Detalhes em [TINYML.md](TINYML.md).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/datasets` | logado | Lista `{ id, nome, descricao, tipo, classes, janela, amostras, colunas, criadoEm }[]` |
| POST | `/datasets` | DEV, ADMIN | Corpo `{ nome, descricao?, tipo, janela?, csv }`. Valida o CSV, calcula classes, amostras e colunas, e grava em `/data/datasets/<id>.csv` |
| DELETE | `/datasets/:id` | DEV, ADMIN | Remove o dataset. `204` |
| POST | `/datasets/arquivo?nome=&tipo=IMAGENS\|SONS\|CONVERSAS&descricao=` | DEV, ADMIN | Envia um arquivo em corpo binário (`Content-Type` livre, até 200 MB). `IMAGENS` aceita `.zip` com uma pasta por classe; `SONS` aceita `.zip` com uma pasta por classe e arquivos `.wav` (PCM 16 bits); `CONVERSAS` aceita `.jsonl`. Valida tudo antes de gravar e responde 400 com a linha ou o arquivo com erro. Devolve o dataset |
| GET | `/datasets/:id/amostra` | logado | Devolve `AmostraDataset` com o campo `formato`. `TABELA`: as 20 primeiras linhas (`{ cabecalho, linhas }`). `IMAGENS`: a quantidade por classe e até 4 `exemplos` por classe. `SONS`: as classes com exemplos (`formato: "SONS"`). `CONVERSAS`: as 5 primeiras conversas |
| GET | `/datasets/:id/imagem?caminho=classe/arquivo.jpg` | logado | Devolve a imagem de um dataset `IMAGENS`. O caminho precisa estar dentro da pasta do dataset |
| GET | `/datasets/:id/audio?caminho=classe/arquivo.wav` | logado | Devolve o `.wav` de um dataset `SONS`. O caminho precisa estar dentro da pasta do dataset |
| GET | `/datasets/:id/csv` | logado | Baixa o CSV (datasets `TABELA`, `SERIE_TEMPORAL` e `AUDIO`) |
| GET | `/datasets/:id/arquivo` | logado | Baixa o arquivo de um dataset `CONVERSAS` (`.jsonl`). Para `IMAGENS` responde 400: baixe as imagens pela pasta do volume |

Formatos dos arquivos de dataset de modelos, com exemplos, estão em [MODELOS.md](MODELOS.md).

### Treinos (`/api/treinos`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/agentes/:id/treinar` | DEV, ADMIN | Só TinyML. Corpo `{ datasetId, parametros?: Partial<ConfigTinyml> }`. Cria o treino em FILA e acorda o despachante, que envia ao `trainer` quando há vaga. Devolve `Treino` (201) com status FILA |
| GET | `/treinos?agenteId=` | logado | Lista `{ id, agenteId, datasetId, status, metricas, tamanhoBytes, criadoEm, finalizadoEm }[]` |
| GET | `/treinos/:id` | logado | Devolve o treino completo, com `log` |
| GET | `/treinos/:id/modelo.tflite` | logado | Baixa o modelo TFLite |
| GET | `/treinos/:id/model_data.h` | logado | Baixa o arquivo C `model_data.h` |

Os downloads exigem o token no cabeçalho. Para baixar pelo navegador, use `fetch` com o token e `URL.createObjectURL`.

### Modelos (`/api/modelos`)

Um modelo tem tipo (`TINYML`, `TABULAR`, `LLM_NUVEM` ou `LLM_LOCAL`), tarefa (`CLASSIFICACAO`, `REGRESSAO`, `IMAGEM` ou `CHAT`) e um dataset padrão. Tipo e tarefa não mudam depois de criado. `ModeloResumo` traz `principal`, a métrica principal do treino publicado.

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/modelos?tipo=&busca=` | logado | Lista `ModeloResumo[]`, do mais recente para o mais antigo |
| GET | `/modelos/opcoes` | logado | Opções da tela de criação: arquiteturas TinyML, algoritmos tabulares com hiperparâmetros, modelos base de LLM e se o `finetuner` está disponível |
| GET | `/modelos/:id` | logado | Devolve o `Modelo` com `treinos` (id ou slug) |
| POST | `/modelos` | DEV, ADMIN | Corpo `{ nome, descricao?, tipo, tarefa, datasetId?, config?, tags? }`. Valida a combinação tipo × tarefa e tipo do dataset. `config` é mesclado sobre o padrão do tipo. Devolve `Modelo` (201) |
| PUT | `/modelos/:id` | DEV, ADMIN | Corpo parcial `{ nome?, descricao?, datasetId?, config?, tags? }` |
| DELETE | `/modelos/:id` | DEV, ADMIN | Remove o modelo e a pasta de artefatos. `204` |
| POST | `/modelos/:id/duplicar` | DEV, ADMIN | Cria `<nome> (cópia)` sem treinos |
| POST | `/modelos/:id/treinar` | DEV, ADMIN | Corpo `{ datasetId?, parametros? }`. Cria um treino novo (numerado) em FILA, que o despachante envia ao serviço do tipo quando há vaga. Devolve o `TreinoModelo` (201) |
| GET | `/modelos/:id/treinos` | logado | Lista `TreinoModeloResumo[]`, do mais recente para o mais antigo |

### Treinos de modelo (`/api/treinos-modelo`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/treinos-modelo/:id` | logado | Devolve o `TreinoModelo` completo, com `log`, `metricas` e `artefatos` |
| POST | `/treinos-modelo/:id/cancelar` | DEV, ADMIN | Cancela um treino em FILA ou EXECUTANDO. Treinos de LLM na nuvem são cancelados na OpenAI. Devolve o treino |
| POST | `/treinos-modelo/:id/publicar` | DEV, ADMIN | Publica um treino em SUCESSO como versão em uso. Desmarca o publicado anterior do mesmo modelo |
| GET | `/treinos-modelo/:id/artefatos/:nome` | logado | Baixa um artefato (`model.tflite`, `model_data.h`, `modelo.joblib`, `adapter_model.safetensors` etc.) |
| POST | `/treinos-modelo/:id/criar-agente` | DEV, ADMIN | Só LLM com SUCESSO. Cria um agente LLM que usa o `modeloResultante` (OpenAI para `LLM_NUVEM`, Ollama para `LLM_LOCAL`) |
| POST | `/treinos-modelo/:id/prever` | logado | Testa um treino com SUCESSO de tipo `TINYML` ou `TABULAR`, pela aba **Testar**. Corpo com exatamente um campo: `valores` (lista de números), `imagemBase64` ou `audioBase64`. Devolve `ResultadoPrevisao`. Entrada inválida responde 400 com a mensagem, e o trainer fora do ar responde 503 |

`ResultadoPrevisao` em classificação:

```json
{
  "classe": "acenar",
  "probabilidades": [{ "classe": "acenar", "valor": 0.91 }, { "classe": "parado", "valor": 0.09 }],
  "saidaBruta": [0.91, 0.09],
  "latenciaMs": 14,
  "avisos": []
}
```

Em regressão, a resposta traz `valor` (já desnormalizado) no lugar de `classe` e `probabilidades`. A `latenciaMs` é a do servidor, não a da placa.

Um treino passa por FILA, EXECUTANDO e depois SUCESSO, FALHA ou CANCELADO. Os treinos de LLM na nuvem são acompanhados em segundo plano, a cada 30 segundos, pelo servidor.

### Projetos e modelos embutidos

`POST /projetos/:id/build` aceita também `modeloTreinoId`. O treino precisa ser de tipo `TINYML` ou `TABULAR`, com status SUCESSO. Os arquivos `HEADER_C` do treino (`model_data.h` e `modelo_tabular.h`) são copiados para `include/` do projeto, e o build fica vinculado ao treino. `agenteId` continua funcionando.

---

## Firmware

### Projetos (`/api/projetos`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/projetos` | logado | Lista `{ id, nome, slug, descricao, placa, framework, atualizadoEm, totalArquivos, ultimoBuild }[]` |
| POST | `/projetos` | DEV, ADMIN | Corpo `{ nome, descricao?, placa, modelo? }`. Cria o projeto com os arquivos-modelo da placa. `modelo` é `BLINK` (padrão), `COLETOR` (coleta pela serial) ou `OTA` (frota; só ESP32 e ESP32-S3, senão responde 400) |
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

### Histórico de versões (`/api/projetos`)

O `:id` aceita o número ou o slug do projeto. As versões automáticas (criadas pelas compilações) não têm autor. Se nada mudou desde a última versão, nenhuma nova é criada.

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/projetos/:id/versoes` | logado | Lista `{ numero, mensagem, autor: { id, nome } \| null, buildId, criadoEm, totalArquivos }[]`, da mais recente para a mais antiga. Não traz o conteúdo dos arquivos |
| POST | `/projetos/:id/versoes` | DEV, ADMIN | Corpo `{ mensagem }` (de 1 a 200 caracteres). Salva o estado atual como versão manual. Devolve a versão (201). Responde 409 se nada mudou desde a última versão |
| GET | `/projetos/:id/versoes/:numero` | logado | Devolve a versão com `arquivos: { caminho, conteudo }[]` |
| POST | `/projetos/:id/versoes/:numero/restaurar` | DEV, ADMIN | Antes de restaurar, salva a versão automática `Antes de restaurar a v<n>` (se houver mudança) e substitui os arquivos do projeto pelos da versão. Devolve `{ restaurada, totalArquivos }` |
| GET | `/projetos/:id/git.zip` | logado | Baixa um `.zip` com um repositório Git, um commit por versão, em ordem crescente. Responde 409 se o projeto não tem versões |

Exemplo, salvando uma versão manual:

```bash
curl -X POST http://localhost:8080/api/projetos/blink-esp32/versoes \
  -H "Authorization: Bearer aic_seu_token" \
  -H "Content-Type: application/json" \
  -d '{"mensagem":"Pisca em 500 ms"}'
```

### Compilações (`/api/builds`)

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/projetos/:id/build` | DEV, ADMIN | Corpo `{ agenteId?, modeloTreinoId? }`. Grava os arquivos em `/data/projetos/<slug>/`, copia o `model_data.h` do agente (se houver treino) para `include/`, grava `include/aic_versao.h` com o id do build e cria o build em FILA. O despachante envia ao `builder` quando há vaga. Devolve `Build` (202) com status FILA |
| GET | `/builds?projetoId=` | logado | Lista `{ id, projetoId, placa, status, tamanhoBytes, offset, criadoEm, finalizadoEm }[]` |
| GET | `/builds/:id` | logado | Devolve a compilação completa, com `log` |
| GET | `/builds/:id/firmware` | logado | Baixa o firmware gerado |
| POST | `/builds/:id/gravar` | DEV, ADMIN | Corpo `{ porta }`. Repassa ao `builder` e devolve `{ ok, log }`. Só funciona no Linux, com a USB mapeada |

### Frota e dispositivos (`/api/dispositivos`)

Os dispositivos cadastrados são as placas da bancada e as da frota OTA. `DispositivoFrota = { id, nome, placa, porta, notas, projetoId, projeto, chavePrefixo, online, ultimoContato, ip, telemetria, buildAtualId, buildAlvoId, ultimaOta, statusOta, ultimoBuildId, ultimaGravacao, criadoEm }`. A chave não aparece nessa resposta: só o prefixo (`chavePrefixo`).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/dispositivos` | logado | Lista `DispositivoFrota[]` |
| GET | `/dispositivos/:id` | logado | Devolve o `DispositivoFrota` |
| POST | `/dispositivos` | DEV, ADMIN | Corpo `{ nome, placa, porta?, notas?, projetoId? }` |
| PUT | `/dispositivos/:id` | DEV, ADMIN | Atualização parcial, com `projetoId?` |
| DELETE | `/dispositivos/:id` | DEV, ADMIN | Remove o dispositivo. `204` |
| POST | `/dispositivos/:id/chave` | DEV, ADMIN | Gera uma chave nova (`aicd_` seguido de 40 hex) e invalida a anterior. Devolve `ChaveGerada` (`{ chave, prefixo }`). A chave aparece só nessa resposta |
| PUT | `/dispositivos/:id/alvo` | DEV, ADMIN | Corpo `{ buildId: number \| null }`. Só aceita build SUCESSO da mesma placa, com firmware OTA. `null` tira o alvo |
| POST | `/dispositivos/:id/comando` | DEV, ADMIN | Corpo `{ acao: "atualizar" \| "reiniciar" }`. Publica o comando no MQTT. Responde 503 se o broker estiver fora |
| GET | `/dispositivos/:id/telemetria?horas=24` | logado | Lista `AmostraTelemetria[]` (`{ em, dados }`), em ordem crescente, com no máximo 2000 pontos |
| GET | `/dispositivos/:id/config.h?chave=` | logado | Baixa o `aic_config.h` para o projeto OTA. Exige a chave gerada agora (a chave não fica guardada em claro no servidor) |

O `aic_config.h` traz `AIC_DISPOSITIVO_ID`, `AIC_DISPOSITIVO_CHAVE`, `AIC_SERVIDOR_URL`, `AIC_MQTT_HOST`, `AIC_MQTT_PORTA`, `AIC_MQTT_USUARIO` e `AIC_MQTT_SENHA`. Os campos `AIC_WIFI_SSID` e `AIC_WIFI_SENHA` vêm vazios para o usuário preencher. O endereço do servidor e do MQTT vem de `SERVIDOR_URL_PUBLICA` e `MQTT_HOST_PUBLICO`; sem eles, usa o host da requisição.

A frota emite eventos `tipo: "dispositivo"` em `/api/eventos` quando muda online, telemetria ou status da OTA.

### Placas OTA (`/api/ota`)

Rotas usadas pela placa, sem login. Exigem os cabeçalhos `X-Dispositivo-Id` e `X-Dispositivo-Chave`. Cada dispositivo tem o limite de 30 requisições por minuto.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/ota/verificar?versao=<buildId atual>` | Devolve `{ atualizar: false }` ou `{ atualizar: true, buildId, url, tamanho, md5 }`. Só oferece builds SUCESSO da mesma placa que for o alvo do dispositivo. Atualiza o último contato |
| GET | `/ota/firmware/:buildId` | Devolve o binário da aplicação (`application/octet-stream`, com `x-MD5`), só para o build alvo |
| POST | `/ota/resultado` | Corpo `{ buildId, ok, mensagem? }`. Grava o status da OTA e, com `ok`, passa a versão atual para o build |

O canal MQTT da frota (telemetria, status e comandos) não é HTTP. Ele está descrito em [ARQUITETURA.md](ARQUITETURA.md#frota-e-ota) e em [FIRMWARE.md](FIRMWARE.md#frota-e-ota).

---

## Rotas internas

Usadas só pelos serviços da plataforma. Exigem `X-Interno-Token`.

| Método | Rota | Quem chama | Descrição |
|---|---|---|---|
| POST | `/interno/treinos/:id` | `trainer` | Atualiza o treino: `{ status, log?, metricas?, modeloTflite?, modeloH?, tamanhoBytes? }`. Em SUCESSO grava `ultimoTreinoId` no agente. `204` |
| POST | `/interno/builds/:id` | `builder` | Atualiza a compilação: `{ status, log?, artefato?, offset?, tamanhoBytes? }`. `204` |
| POST | `/interno/treinos-modelo/:id` | `trainer` e `finetuner` | Atualiza o treino de modelo: `{ status?, log? (acrescenta), metricas?, artefatos?, modeloResultante?, externoId? }`. `204` |

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
