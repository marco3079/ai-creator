# Contratos — área "Modelos"

Complementa `CONTRATOS.md` (continua valendo tudo de lá: convenções de módulos, `lib/*`, autenticação, erros, idioma).
Arquivos escritos pelo `main` (somente leitura para os geradores):
`server/prisma/schema.prisma` (modelos `Modelo`, `TreinoModelo`, enum `TipoModelo`, `Build.modeloTreinoId`), `client/src/lib/tipos-modelos.ts` (todos os tipos TS desta área), este arquivo.

## 1. Conceito

Um **Modelo** é independente dos agentes: tem tipo, tarefa, dataset padrão e configuração. Cada clique em "Treinar" cria um **TreinoModelo** (experimento, `numero` 1, 2, 3...) com os parâmetros usados, log, métricas e artefatos. O usuário compara treinos e **publica** um deles (a versão em uso). Projetos de firmware embutem um treino (TinyML/Tabular) e agentes LLM usam o modelo resultante de um treino LLM.

| Tipo | Tarefas | Datasets aceitos | Onde treina | Artefatos |
|---|---|---|---|---|
| `TINYML` | `CLASSIFICACAO`, `REGRESSAO`, `IMAGEM` | CSV (SERIE_TEMPORAL/TABELA/AUDIO) ou IMAGENS | trainer (`/modelos/treinos`) | `model.tflite` (TFLITE), `model_data.h` (HEADER_C), `metricas.json` (METRICAS) |
| `TABULAR` | `CLASSIFICACAO`, `REGRESSAO` | CSV | trainer (`/modelos/treinos`) | `modelo.joblib` (JOBLIB), `modelo_tabular.h` (HEADER_C, se `exportarC` e o algoritmo exportar), `metricas.json` |
| `LLM_NUVEM` | `CHAT` | CONVERSAS | API da OpenAI (o próprio server) | `modeloResultante = "ft:..."` |
| `LLM_LOCAL` | `CHAT` | CONVERSAS | finetuner (GPU, perfil `gpu`) | `adapter_model.safetensors`, `adapter_config.json` (ADAPTER); `modeloResultante` = nome no Ollama |

`Artefato = { nome, tipo, caminho (relativo a /data), tamanhoBytes }`, sempre em `/data/modelos/<modeloId>/treinos/<numero>/`.

## 2. Configuração padrão (`server/src/modules/modelos/padroes.ts` exporta `configPadrao(tipo, tarefa)`)

- TINYML: `{ entrada:{tipo:'SERIE_TEMPORAL',canais:3,janela:50,frequenciaHz:50,imagem:{largura:96,altura:96,cores:1}}, arquitetura:'DENSA', camadas:2, neuronios:32, epocas:30, taxaAprendizado:0.001, tamanhoLote:32, quantizacao:'INT8', aumentoDados:false, placaAlvo:'ESP32', limiteRamKb:64, limiteFlashKb:256 }`. Para tarefa `IMAGEM`: `entrada.tipo='IMAGENS'`, `arquitetura='CNN2D'`, `epocas=40`, `taxaAprendizado=0.003`, `tamanhoLote=16`, `aumentoDados=true`, `placaAlvo='ESP32S3'`, `limiteRamKb=320`, `limiteFlashKb=1024`.
- TABULAR: `{ algoritmo:'RANDOM_FOREST', hiperparametros:{n_estimators:50,max_depth:8}, testeFracao:0.2, validacaoCruzada:5, normalizar:true, exportarC:true }`. Para `REGRESSAO` o mesmo algoritmo (regressor).
- LLM_NUVEM: `{ provedor:'OPENAI', modeloBase:'gpt-4.1-mini-2025-04-14', epocas:null, tamanhoLote:null, multiplicadorTaxa:null, sufixo:'', promptSistema:'' }`.
- LLM_LOCAL: `{ modeloBase:'llama3.2:1b', loraRank:16, loraAlpha:32, epocas:3, taxaAprendizado:0.0002, tamanhoLote:2, comprimentoMax:1024, nomeOllama:'', promptSistema:'' }`.

## 3. Opções (`GET /modelos/opcoes`, `server/src/modules/modelos/opcoes.ts`)

Resposta `OpcoesModelos` (ver `tipos-modelos.ts`):
- `tinyml.arquiteturas`: DENSA (CLASSIFICACAO, REGRESSAO), CNN1D (CLASSIFICACAO, REGRESSAO), DS_CNN (CLASSIFICACAO), CNN2D (IMAGEM).
- `tabular.algoritmos` (rótulo, tarefas, exportaC, hiperparâmetros com padrão/min/max):
  - ARVORE "Árvore de decisão" — ambas, exportaC ✔ — `max_depth` int 1..50 (8), `min_samples_leaf` int 1..50 (1)
  - RANDOM_FOREST "Random Forest" — ambas, ✔ — `n_estimators` int 5..500 (50), `max_depth` int 1..50 (8)
  - GRADIENT_BOOSTING "Gradient Boosting" — ambas, ✘ (o m2cgen 0.10 não exporta) — `n_estimators` 10..500 (100), `learning_rate` decimal 0.001..1 (0.1), `max_depth` 1..10 (3)
  - LOGISTICA "Regressão logística" — CLASSIFICACAO, ✔ — `C` decimal 0.001..100 (1), `max_iter` int 100..5000 (1000)
  - LINEAR "Regressão linear (Ridge)" — REGRESSAO, ✔ — `alpha` decimal 0..100 (1)
  - KNN "k vizinhos (KNN)" — ambas, ✘ — `n_neighbors` int 1..50 (5)
  - SVM "SVM" — ambas, ✔ (só kernel linear exporta) — `C` decimal 0.001..100 (1), `kernel` opcao [linear, rbf] (rbf)
- `llmNuvem`: `{ disponivel: !!config.openaiChave, modelosBase: ['gpt-4.1-mini-2025-04-14','gpt-4.1-nano-2025-04-14','gpt-4o-mini-2024-07-18'] }` (o usuário pode digitar outro).
- `llmLocal`: `GET {FINETUNER_URL}/saude` (timeout 2 s) → `{ disponivel, gpu, dispositivo, modelosBase:['llama3.2:1b','llama3.2:3b'] }`; se falhar, `{disponivel:false,gpu:false,dispositivo:'',...}`.
Nova variável no `lib/config.ts`: **`finetunerUrl`** (`FINETUNER_URL`, padrão `http://finetuner:8003`). O g01 do servidor base não existe mais: quem adiciona a linha é o **m01**.

## 4. API (prefixo /api, mesmas regras: `autenticar` em todas, escrita com `exigirPerfil('ADMIN','DEV')`)

**modelos (m01)** — `server/src/modules/modelos/`
- `GET /modelos?tipo=&busca=` → `ModeloResumo[]` (atualizadoEm desc). `principal` do publicado vem de `metricas.principal`.
- `GET /modelos/opcoes` → `OpcoesModelos` (**declarar antes** de `/modelos/:id`).
- `GET /modelos/:id` (id ou slug) → `Modelo` (com `treinos: TreinoModeloResumo[]`, numero desc).
- `POST /modelos` `{nome, descricao?, tipo, tarefa, datasetId?, config?, tags?}` → `Modelo` (valida tarefa × tipo e tipo do dataset × tipo do modelo pela tabela §1; `config` mesclado sobre `configPadrao`). 201.
- `PUT /modelos/:id` `{nome?, descricao?, datasetId?, config?, tags?}` (tipo e tarefa não mudam). `DELETE /modelos/:id` → 204 (apaga `/data/modelos/<id>`). `POST /modelos/:id/duplicar` → `Modelo` ("<nome> (cópia)", sem treinos).

**datasets (m01, amplia o módulo existente `server/src/modules/datasets/`)**
- `POST /datasets/arquivo?nome=...&tipo=IMAGENS|CONVERSAS&descricao=...` com corpo **binário** (`express.raw({ type: '*/*', limit: '200mb' })` só nessa rota):
  - IMAGENS: `.zip`. Extrai (dependência `adm-zip` **0.5.16**) para `/data/datasets/<id>/`. Aceita `classe/arquivo.jpg` ou `raiz/classe/arquivo.jpg` (uma pasta raiz única é desembrulhada). Extensões jpg/jpeg/png/bmp/gif. Ignora `__MACOSX` e arquivos ocultos. Recusa caminhos com `..`. Precisa de ≥2 classes e ≥2 imagens por classe. `classes` = nomes das pastas ordenados, `amostras` = total de imagens, `caminhoArquivo = "datasets/<id>/"`.
  - CONVERSAS: `.jsonl` UTF-8, uma conversa por linha `{"messages":[{"role":"system|user|assistant","content":"..."}]}`; cada uma precisa de ≥1 `user` e ≥1 `assistant`, a última mensagem `assistant`. Mínimo 10 linhas (exigência da OpenAI). Erro 400 com o número da linha. `caminhoArquivo="datasets/<id>.jsonl"`, `amostras` = linhas.
- `GET /datasets/:id/amostra` passa a devolver `AmostraDataset` (com `formato`): TABELA = resposta atual + `formato:'TABELA'`; IMAGENS = por classe a quantidade e até 4 `exemplos` (caminhos relativos à pasta do dataset); CONVERSAS = 5 primeiras conversas.
- `GET /datasets/:id/imagem?caminho=classe/arquivo.jpg` → arquivo (só IMAGENS; valida caminho dentro da pasta).
- `GET /datasets/:id/csv` continua; para IMAGENS/CONVERSAS vira `GET /datasets/:id/arquivo` (zip refeito na hora não é necessário: devolve o `.jsonl`; para IMAGENS responde 400 "Baixe as imagens pela pasta do volume").

**treinos de modelo (m02)** — `server/src/modules/treinos-modelo/`
- `POST /modelos/:id/treinar` `{ datasetId?, parametros?: Partial<config> }` → `TreinoModelo` (201). `numero` = maior + 1. Dataset = `datasetId` ?? `modelo.datasetId` (400 "Escolha um dataset" se nenhum); valida compatibilidade (§1). `parametros` = config do modelo mesclado com o pedido. Despacha (status EXECUTANDO, `iniciadoEm`):
  - TINYML / TABULAR → `POST {trainerUrl}/modelos/treinos` (§5). Trainer fora → FALHA "Serviço de treino indisponível".
  - LLM_NUVEM → `iniciarAjusteOpenai(treinoId)` de `./openai` (m03). Sem chave → FALHA "OPENAI_API_KEY não configurada no servidor (.env)."
  - LLM_LOCAL → `POST {finetunerUrl}/treinos` (§6). Fora → FALHA "Serviço finetuner indisponível. Suba com: docker compose --profile gpu up -d finetuner".
- `GET /modelos/:id/treinos` → `TreinoModeloResumo[]`. `GET /treinos-modelo/:id` → `TreinoModelo`.
- `POST /treinos-modelo/:id/cancelar` → só FILA/EXECUTANDO; LLM_NUVEM chama `cancelarAjusteOpenai`; demais marcam CANCELADO (o callback que chegar depois é ignorado se o status já for CANCELADO).
- `POST /treinos-modelo/:id/publicar` → só SUCESSO; desmarca os outros do mesmo modelo (transação).
- `GET /treinos-modelo/:id/artefatos/:nome` → download (nome tem que estar em `artefatos`).
- `POST /treinos-modelo/:id/criar-agente` → só LLM_* com SUCESSO e `modeloResultante`: cria Agente LLM (provedor OPENAI p/ LLM_NUVEM, OLLAMA p/ LLM_LOCAL; `modelo = modeloResultante`; `promptSistema` da config; nome "<modelo> v<numero>"; VersaoAgente 1 "Criado a partir do modelo"). Usar as funções/regras do módulo agentes (importar de `../agentes/...` o que já existir; não editar arquivos de agentes).
- `POST /interno/treinos-modelo/:id` (`exigirInterno`) `{ status?, log? (acrescenta), metricas?, artefatos?, modeloResultante?, externoId? }` → 204. SUCESSO/FALHA gravam `finalizadoEm`. Ignora tudo se o treino já estiver CANCELADO.
- **Builds** (m02 edita `server/src/modules/projetos/routes.ts`): `POST /projetos/:id/build` aceita também `modeloTreinoId`; se vier, o treino precisa ser TINYML/TABULAR com SUCESSO; copia **todos os artefatos `HEADER_C`** para `include/` do projeto e grava `Build.modeloTreinoId`. `agenteId` continua funcionando.
- Painel (`GET /painel`) **não** muda.

**OpenAI (m03)** — `server/src/modules/treinos-modelo/openai.ts` e `worker.ts`
- `export async function iniciarAjusteOpenai(treinoId: number): Promise<void>`: lê treino+modelo+dataset; envia o JSONL (`POST https://api.openai.com/v1/files`, multipart com `FormData`/`Blob` do Node 20, `purpose=fine-tune`); se `promptSistema` não estiver vazio, insere a mensagem `system` no início das conversas que não tiverem uma (gera um arquivo temporário); cria o job `POST /v1/fine_tuning/jobs` `{ training_file, model: modeloBase, suffix?, method:{ type:'supervised', supervised:{ hyperparameters:{ n_epochs, batch_size, learning_rate_multiplier } } } }` (omitir os `null` / usar `'auto'`); grava `externoId` e acrescenta log. Erros HTTP → FALHA com a mensagem da OpenAI.
- `export async function sincronizarAjustesOpenai(): Promise<void>`: para cada TreinoModelo EXECUTANDO de LLM_NUVEM com `externoId`, `GET /v1/fine_tuning/jobs/{id}` e `GET /v1/fine_tuning/jobs/{id}/events?limit=50` (acrescenta ao log só eventos novos — guarde o último id em `metricas.ultimoEventoId`); mapeia `succeeded`→SUCESSO (`modeloResultante = fine_tuned_model`, `metricas.tokensTreinados = trained_tokens`, `metricas.principal = {nome:'tokensTreinados', rotulo:'Tokens treinados', valor, formato:'numero'}`), `failed`→FALHA (log com `error.message`), `cancelled`→CANCELADO; `metricas.historico` a partir dos eventos `metrics` (`data.step`, `data.train_loss`, `data.valid_loss`).
- `export async function cancelarAjusteOpenai(treinoId: number): Promise<void>` → `POST /v1/fine_tuning/jobs/{id}/cancel`.
- `worker.ts`: `export function iniciarWorkerOpenai(): void` — `setInterval(sincronizarAjustesOpenai, 30_000)` com proteção contra execuções sobrepostas e `try/catch` (loga e segue). Idempotente (chamar duas vezes não cria dois timers). O m02 chama no topo de `treinos-modelo/routes.ts`.
- Header `Authorization: Bearer ${config.openaiChave}`. Nada de SDK novo.

## 5. Trainer — `POST /modelos/treinos` (m04 dono do roteamento; m05 do tabular)

Pedido: `{ treinoId, tipo:'TINYML'|'TABULAR', tarefa, dataset:{ tipo, caminho: "/data/datasets/3.csv" | "/data/datasets/4/" , classes: string[] }, saidaDir: "/data/modelos/<modeloId>/treinos/<numero>", config, callbackUrl, callbackToken }` → 202.
Roda em **processo filho** (`spawn`, igual ao treino atual) e chama o callback (header `X-Interno-Token`) com: EXECUTANDO no início; `log` em blocos (a cada época ou etapa); no fim SUCESSO com `metricas` + `artefatos` (caminhos relativos a `/data`) ou FALHA com o traceback. O pai envia FALHA se o filho morrer sem callback final.

`metricas.principal`: CLASSIFICACAO/IMAGEM → `acuraciaValidacao` ("Acurácia (val.)", percentual) [tabular: `acuracia` no conjunto de teste, "Acurácia (teste)"]; REGRESSAO → `r2` ("R²", numero). `metricas.historico` por época nas redes.

TINYML (m04, `trainer/app/modelos/tinyml.py`):
- CLASSIFICACAO: igual ao treino atual (reaproveite `app/treino.py`/`exportar.py` importando funções; não quebre o endpoint antigo `/treinos`).
- REGRESSAO: CSV com `rotulo` numérico; saída `Dense(1)` linear, perda MSE; métricas mae/rmse/r2 (no conjunto de validação). INT8 com saída float32 permitida (`inference_output_type` float32) — anote no log.
- IMAGEM: `tf.keras.utils.image_dataset_from_directory(caminho, image_size=(altura,largura), color_mode='grayscale'|'rgb', batch_size, validation_split=0.2, subset=..., seed=42, class_names=classes)`; normaliza /255 dentro do modelo (`Rescaling`); `aumentoDados` → `RandomFlip('horizontal')` + `RandomRotation(0.05)` (só no treino); CNN2D: `camadas` × [Conv2D(neuronios·2^i limitado a 128, 3, relu, padding same) + MaxPool2D] → GlobalMaxPooling2D → Dropout 0.2 → Dense softmax. Representativo INT8 = 100 imagens do treino. Matriz de confusão no conjunto de validação.
- Sempre: `model.tflite`, `model_data.h` (`para_header_c`, nome `g_model`), `metricas.json`; alerta no log se o `.tflite` passar de `limiteFlashKb`.

TABULAR (m05, `trainer/app/modelos/tabular.py`, função `executar_tabular(pedido, enviar)`):
- scikit-learn (fixar `scikit-learn==1.5.1`, já existe), `joblib==1.4.2`, `m2cgen==0.10.0` em `requirements.txt`.
- `rotulo` = alvo (texto → classificação; numérico em REGRESSAO). Split estratificado (classificação) com `testeFracao`; `normalizar` → `Pipeline([StandardScaler, modelo])` (para exportar C, exporte o modelo **sem** o scaler e gere no header as constantes `aic_media[]`/`aic_escala[]` + função `aic_normalizar(double*)`); validação cruzada k-fold se `validacaoCruzada>=2`.
- Métricas: classificação acuracia/f1 (macro)/precisao/recall/matrizConfusao/classes; regressão mae/rmse/r2; `validacaoCruzada {media,desvio,k}`.
- `modelo.joblib` sempre; `exportarC` e algoritmo exportável → `m2cgen.export_to_c(modelo)` embrulhado em `modelo_tabular.h` com `#pragma once`, função renomeada para `static void aic_prever(double* input, double* output)`, comentário com a ordem das features e (classificação) o vetor `aic_classes[]`. Se o m2cgen falhar, log de aviso e segue sem o header.

## 6. Finetuner — serviço novo `finetuner/` (m06), porta 8003, perfil `gpu`

- `GET /saude` → `{ ok:true, gpu: torch.cuda.is_available(), dispositivo: 'cuda'|'cpu' }`.
- `POST /treinos` `{ treinoId, dataset: "/data/datasets/5.jsonl", saidaDir, config: ConfigModeloLlmLocal, nomeOllama, ollamaUrl, callbackUrl, callbackToken }` → 202. Processo filho; base HF: `llama3.2:1b`→`unsloth/Llama-3.2-1B-Instruct`, `llama3.2:3b`→`unsloth/Llama-3.2-3B-Instruct` (cache em `/root/.cache/huggingface`, volume `hf`). PEFT LoRA (`r`, `lora_alpha`, `target_modules=["q_proj","k_proj","v_proj","o_proj"]`, dropout 0.05) + TRL `SFTTrainer` (mensagens com `apply_chat_template`, `max_seq_length=comprimentoMax`), fp16 se CUDA. Log por passo via callback do Trainer. Salva o adaptador (`adapter_model.safetensors`, `adapter_config.json`) em `saidaDir`.
- Registro no Ollama (`ollamaUrl`, padrão `http://ollama:11434`): garante a base (`POST /api/pull {model: modeloBase, stream:false}`), sobe cada arquivo como blob (`POST /api/blobs/sha256:<hex>` com o corpo do arquivo) e cria `POST /api/create { model: nomeOllama, from: modeloBase, adapters: { "adapter_model.safetensors": "sha256:...", "adapter_config.json": "sha256:..." }, system: promptSistema?, stream:false }`. SUCESSO com `modeloResultante = nomeOllama`, artefatos ADAPTER, `metricas.perda` final, `historico`, `principal = {nome:'perda', rotulo:'Perda final', formato:'numero'}`. Se o Ollama não responder: SUCESSO com aviso no log e `modeloResultante = null`.
- Versões fixas: `torch==2.5.1`, `transformers==4.46.3`, `peft==0.13.2`, `trl==0.12.1`, `datasets==3.1.0`, `accelerate==1.1.1`, `fastapi==0.115.0`, `uvicorn==0.30.6`, `httpx==0.27.2`, `pytest==8.3.2`.
- O server manda `nomeOllama` = `config.nomeOllama || "aic-" + slug + "-v" + numero`.

## 7. Cliente

- Menu: novo grupo **"Modelos"** depois de "Agentes" com o ícone novo **`laboratorio`** (frasco de laboratório). `grupos.ts`: `{ titulo: 'Modelos', icones: ['laboratorio'] }`.
- Rotas (todas `perfis: ['ADMIN','DEV','LEITOR']`):
  - `/app/modelos` — Lista (ícone `laboratorio`, ordem 15, rótulo "Modelos") — m07
  - `/app/modelos/novo` — assistente de criação (menu false, `?tipo=`) — m07
  - `/app/modelos/:id` — detalhe (menu false) — m08 (`client/src/modules/modelos/Detalhe.tsx`, `export function DetalheModelo()`)
- `client/src/modules/modelos/FormularioConfig.tsx` (m07) exporta `export function FormularioConfigModelo({ tipo, tarefa, valor, aoMudar, opcoes, somenteLeitura }: { tipo: TipoModelo; tarefa: TarefaModelo; valor: ConfigModelo; aoMudar: (v: ConfigModelo) => void; opcoes: OpcoesModelos; somenteLeitura?: boolean })` — usado pelo m08 na aba Configuração.
- `client/src/modules/modelos/comum.ts` (m07) exporta `formatarMetrica(m: MetricaPrincipal): string`, `rotuloTipo(t: TipoModelo): string`, `iconeTipo(t: TipoModelo): NomeIcone` (TINYML→cerebro, TABULAR→grafico, LLM_NUVEM→robo, LLM_LOCAL→chip).
- Firmware (m09): seletor "Embutir modelo" no painel Compilar passa a ter dois grupos (`<optgroup>`): "Agentes TinyML" (como hoje, envia `agenteId`) e "Modelos treinados" (treinos SUCESSO de modelos TINYML/TABULAR, rótulo "<modelo> v<numero> (publicado)", envia `modeloTreinoId`). Fonte: `GET /modelos?tipo=TINYML` e `?tipo=TABULAR` + `GET /modelos/:id/treinos`.
- Datasets (m09): "Novo dataset" ganha os tipos IMAGENS (escolher `.zip`, prévia: nº de arquivos) e CONVERSAS (`.jsonl`), enviados com `fetch` para `/api/datasets/arquivo?...` (corpo = `File`, header Authorization). "Ver amostra" trata os 3 formatos (IMAGENS: grade de miniaturas por classe, buscadas com token → blob URL; CONVERSAS: balões).
- Correção (m09): no `Layout`, o item "Agentes LLM" (`/app/agentes`) usa `end` (casamento exato), para não acender ao abrir `/app/agentes/:id` de um agente TinyML. O editor de agentes não acende nenhum item.

## 8. Integrações (m10)
MCP (`integrations/claude-code/mcp-server`): + `listar_modelos {tipo?, busca?}`, `criar_modelo {nome, tipo, tarefa, datasetId?, config?}`, `treinar_modelo {modelo, datasetId?, parametros?}`, `status_treino_modelo {id}` (**18** ferramentas no total: as 14 de antes + 4). Recompilar `dist/`.
