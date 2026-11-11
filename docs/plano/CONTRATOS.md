# Contratos — AI Creator

Fonte única de verdade entre as partes. Nenhum gerador muda um contrato sem o `main` aprovar.

Referência visual e de código: repositório clonado em
`<clone local de https://github.com/marco3079/sistema-escolar>`
(chamado aqui de `REF`). Pode ler à vontade; **nunca** editar nada lá.

Raiz do projeto: `<raiz do repositório>` (chamada de `RAIZ`).
Idioma: tudo em português (nomes de variáveis, textos de tela, comentários), como no `REF`.

## 1. Serviços e portas

| Serviço | Pasta | Tecnologia | Porta interna | Host (compose) |
|---|---|---|---|---|
| db | — | postgres:16-alpine | 5432 | — |
| server | `server/` | Node 20, Express 4, Prisma 5, TypeScript, rodando com `tsx` | 3333 | — |
| client | `client/` | React 18 + Vite 5 + TS, servido por nginx | 80 | 8080 |
| trainer | `trainer/` | Python 3.11, FastAPI, TensorFlow CPU | 8001 | — |
| builder | `builder/` | Python 3.11, FastAPI, PlatformIO | 8002 | — |
| ollama (perfil `ollama`) | — | ollama/ollama | 11434 | — |

Volume compartilhado `dados` montado em **`/data`** no server, trainer e builder.
Subpastas: `/data/datasets/<id>.csv`, `/data/treinos/<id>/`, `/data/projetos/<slug>/`, `/data/builds/<id>/`.

### Variáveis de ambiente do server (`server/src/lib/config.ts` exporta `config`)

| Variável | Padrão | Campo em `config` |
|---|---|---|
| `PORT` | `3333` | `porta: number` |
| `DATABASE_URL` | — | (Prisma lê direto) |
| `JWT_SECRET` | `troque-este-segredo` | `jwtSegredo` |
| `DATA_DIR` | `/data` (dev local: `./dados`) | `dataDir` |
| `TRAINER_URL` | `http://trainer:8001` | `trainerUrl` |
| `BUILDER_URL` | `http://builder:8002` | `builderUrl` |
| `SERVER_URL_INTERNO` | `http://server:3333` | `serverUrlInterno` |
| `INTERNO_TOKEN` | `troque-token-interno` | `internoToken` |
| `ANTHROPIC_API_KEY` | vazio | (SDK lê direto) |
| `OPENAI_API_KEY` | vazio | `openaiChave` |
| `OLLAMA_URL` | `http://ollama:11434` | `ollamaUrl` |
| `ADMIN_EMAIL` / `ADMIN_SENHA` | `admin@aicreator.local` / `trocar123` | (só o seed) |

Trainer e builder recebem só `DATA_DIR=/data`.

## 2. Banco de dados

`server/prisma/schema.prisma` já está escrito pelo `main` e é **somente leitura** para os geradores.

### ConfigTinyml (JSON em `Agente.configTinyml`)

```ts
interface ConfigTinyml {
  tarefa: 'CLASSIFICACAO';
  entrada: { tipo: 'SERIE_TEMPORAL' | 'AUDIO' | 'TABELA'; canais: number; janela: number; frequenciaHz: number };
  classes: string[];
  arquitetura: 'DENSA' | 'CNN1D' | 'DS_CNN';
  camadas: number;          // 1..6
  neuronios: number;        // 4..256
  epocas: number;           // 1..500
  taxaAprendizado: number;  // ex.: 0.001
  quantizacao: 'INT8' | 'FLOAT32';
  placaAlvo: Placa;
  limiteRamKb: number;
  limiteFlashKb: number;
  datasetId: number | null;
  ultimoTreinoId: number | null;
}
```
Valor padrão (`CONFIG_TINYML_PADRAO`): `{ tarefa:'CLASSIFICACAO', entrada:{tipo:'SERIE_TEMPORAL',canais:3,janela:50,frequenciaHz:50}, classes:[], arquitetura:'DENSA', camadas:2, neuronios:32, epocas:30, taxaAprendizado:0.001, quantizacao:'INT8', placaAlvo:'ESP32', limiteRamKb:64, limiteFlashKb:256, datasetId:null, ultimoTreinoId:null }`.

### Placas → PlatformIO

| Placa | platform | board | framework | artefato | offset |
|---|---|---|---|---|---|
| ESP32 | espressif32 | esp32dev | arduino | `firmware-merged.bin` (bootloader 0x1000 + partitions 0x8000 + app 0x10000) | `0x0` |
| ESP32S3 | espressif32 | esp32-s3-devkitc-1 | arduino | `firmware-merged.bin` (bootloader 0x0 + 0x8000 + 0x10000) | `0x0` |
| ARDUINO_NANO33BLE | nordicnrf52 | nano33ble | arduino | `firmware.bin` | — |
| ARDUINO_UNO | atmelavr | uno | arduino | `firmware.hex` | — |
| STM32_NUCLEO_F401RE | ststm32 | nucleo_f401re | arduino | `firmware.bin` | `0x08000000` |
| RP2040_PICO | raspberrypi | pico | arduino | `firmware.uf2` | — |

O nome do ambiente no `platformio.ini` é sempre `[env:principal]`.

## 3. API HTTP (server)

- Prefixo `/api`. JSON. Erro sempre `{ "erro": "mensagem em português" }` com status adequado.
- Autenticação: header `Authorization: Bearer <jwt>` **ou** `Authorization: Bearer aic_<token-de-api>`.
- Perfis: `ADMIN` (tudo), `DEV` (cria/edita/executa), `LEITOR` (só GET). Toda rota de escrita usa `exigirPerfil('ADMIN','DEV')`, salvo indicação.
- Rotas `/api/interno/*` usam `exigirInterno` (header `X-Interno-Token` = `INTERNO_TOKEN`), sem JWT.

### Convenção de módulos do server
Cada módulo é `server/src/modules/<modulo>/routes.ts` com `export default router` (um `express.Router()`), declarando caminhos **completos sem o /api** (ex.: `router.get('/agentes', ...)`).
`app.ts` lê a pasta `src/modules` na inicialização e faz `app.use('/api', router)` para cada `routes.ts` encontrado (import dinâmico). Nenhum gerador edita `app.ts` além do g01.

### Bibliotecas comuns (g01 cria; os outros só importam)

```ts
// server/src/lib/prisma.ts
export const prisma: PrismaClient;
// server/src/lib/config.ts
export const config: { porta:number; jwtSegredo:string; dataDir:string; trainerUrl:string; builderUrl:string; serverUrlInterno:string; internoToken:string; openaiChave:string; ollamaUrl:string };
// server/src/lib/erros.ts
export class ErroHttp extends Error { constructor(public status: number, mensagem: string) }
export function rota(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler; // repassa erros ao next
// server/src/lib/auth.ts
export interface UsuarioReq { id: number; nome: string; email: string; perfil: 'ADMIN'|'DEV'|'LEITOR' }
declare global { namespace Express { interface Request { usuario?: UsuarioReq } } }
export const autenticar: RequestHandler;            // 401 se faltar/for inválido
export function exigirPerfil(...perfis: UsuarioReq['perfil'][]): RequestHandler; // 403
export const exigirInterno: RequestHandler;          // 401 se X-Interno-Token errado
export function assinarJwt(u: UsuarioReq): string;   // expira em 12h
// server/src/lib/log.ts
export async function registrar(usuarioId: number | null, acao: string, detalhe?: string): Promise<void>; // nunca lança
// server/src/lib/slug.ts
export function gerarSlug(texto: string): string; // "Detector de Gestos!" -> "detector-de-gestos"
export async function slugUnico(base: string, existe: (s: string) => Promise<boolean>): Promise<string>; // acrescenta -2, -3...
// server/src/lib/arquivos.ts
export function caminhoDados(...partes: string[]): string; // path.join(config.dataDir, ...partes) com mkdir do diretório pai
```
O tratador de erros em `app.ts` converte `ErroHttp` → status/mensagem, `ZodError` → 400 com a primeira mensagem, resto → 500 "Erro interno". `express.json({ limit: '25mb' })`.

### Rotas por módulo

**auth / usuarios / tokens / plataforma / logs / painel (g01)**
- `POST /auth/login` `{email, senha}` → `{ token, usuario: UsuarioPublico }`. `UsuarioPublico = { id, nome, email, perfil }`.
- `POST /auth/sair` → 204. `GET /auth/eu` → `{ usuario: UsuarioPublico }`.
- `GET /usuarios` (ADMIN) → `UsuarioPublico & { ativo, criadoEm }[]`; `POST /usuarios` `{nome,email,senha,perfil}`; `PUT /usuarios/:id` `{nome?,email?,senha?,perfil?,ativo?}`; `DELETE /usuarios/:id` → 204 (não deixa apagar a si mesmo).
- `GET /tokens` → `{ id, nome, prefixo, criadoEm, ultimoUso, revogado }[]` (só do usuário logado). `POST /tokens` `{nome}` → `{ token: "aic_<40 hex>", registro }` (token em claro só nesta resposta). `DELETE /tokens/:id` → 204 (marca revogado).
- `GET /plataforma` (**público**) → `{ nome, slogan, corPrimaria }`. `PUT /plataforma` (ADMIN).
- `GET /logs` (ADMIN) → `{ id, acao, detalhe, criadoEm, usuario: {id,nome}|null }[]` (200 mais recentes).
- `GET /saude` (público) → `{ ok: true }`.
- `GET /painel` → `{ contagens: { agentesLlm, agentesTinyml, projetos, dispositivos, treinosSucesso, buildsSucesso }, buildsPorDia: { dia: 'YYYY-MM-DD', sucesso: number, falha: number }[] /* 14 dias, inclui dias zerados */, recentes: { tipo: 'BUILD'|'TREINO', id, titulo, status, criadoEm }[] /* 6 */, destaque: AgenteResumo | null /* agente atualizado por último */ }`.

**agentes / llm (g03)**
- `AgenteResumo = { id, nome, slug, descricao, tipo, tags, provedor, modelo, versao, atualizadoEm, projeto: {id,nome}|null }`.
- `Agente = AgenteResumo & { promptSistema, esforco, temperatura, maxTokens, ferramentas: string[], configTinyml: ConfigTinyml|null, projetoId, criadoEm }`.
- `AgenteEntrada` (zod) = `{ nome, descricao?, tipo, tags?, projetoId?, provedor?, modelo?, promptSistema?, esforco?, temperatura?, maxTokens?, ferramentas?, configTinyml? }`. Para `tipo:'TINYML'` sem `configTinyml`, grava `CONFIG_TINYML_PADRAO`.
- `GET /agentes?tipo=LLM|TINYML&busca=texto` → `AgenteResumo[]` (ordem: atualizadoEm desc).
- `GET /agentes/:id` (aceita id numérico **ou** slug) → `Agente`.
- `POST /agentes` → `Agente` (cria VersaoAgente 1, nota "Criação").
- `PUT /agentes/:id` `AgenteEntrada parcial + { nota?: string }` → `Agente` (versao+1 e novo VersaoAgente com snapshot do agente completo).
- `DELETE /agentes/:id` → 204. `POST /agentes/:id/duplicar` → `Agente` ("<nome> (cópia)").
- `GET /agentes/:id/versoes` → `{ versao, nota, criadoEm }[]`. `GET /agentes/:id/versoes/:versao` → `{ versao, nota, criadoEm, snapshot }`. `POST /agentes/:id/versoes/:versao/restaurar` → `Agente` (gera nova versão "Restaurado da vN").
- `GET /agentes/:id/exportar?formato=md|json` → texto. `md` só para LLM, no formato de subagente do Claude Code (abaixo). `json` = `Agente` sem ids.
- `POST /agentes/importar` `{ conteudo: string, formato: 'md'|'json' }` → `Agente`. Se já existir agente com o mesmo slug, **atualiza** (nova versão, nota "Importado") em vez de criar.
- `POST /agentes/:id/executar` `{ mensagens: MensagemChat[] }` → **SSE** (`text/event-stream`). Cada evento é `data: <json>\n\n` com `{tipo:'texto', texto}` | `{tipo:'fim', uso:{entrada,saida}}` | `{tipo:'erro', erro}`. Só LLM. Aborta o provedor quando o cliente desconecta.
- `GET /agentes/:id/conversas` → `{id,titulo,atualizadoEm}[]`; `GET /conversas/:id` → `{id,titulo,mensagens}`; `POST /agentes/:id/conversas` `{titulo, mensagens}` → conversa; `PUT /conversas/:id` `{mensagens}`; `DELETE /conversas/:id`.
- `GET /llm/modelos` → `{ ANTHROPIC: string[], OPENAI: string[], OLLAMA: string[] }` (OLLAMA via `GET {OLLAMA_URL}/api/tags`, timeout 2 s, `[]` se falhar) e `GET /llm/status` → `{ ANTHROPIC: boolean, OPENAI: boolean, OLLAMA: boolean }` (chave configurada / ollama respondeu).

Formato `.md` (subagente do Claude Code):
```
---
name: <slug>
description: <descricao em uma linha>
model: <opus|sonnet|haiku|inherit>
tools: <ferramentas separadas por ", ">   ← linha omitida se a lista for vazia
---

<promptSistema>
```
`model` vem de `modelo`: contém "opus"→opus, "sonnet"→sonnet, "haiku"→haiku, senão inherit. Na importação: opus→`claude-opus-5-5`, sonnet→`claude-sonnet-5-5`, haiku→`claude-haiku-5-5`, inherit/ausente→`claude-opus-5-5`; provedor ANTHROPIC; `nome` = name com hífens trocados por espaço e primeira letra maiúscula.

**datasets / treinos (g05)**
- CSV de dataset: primeira linha é cabeçalho `rotulo,f0,f1,...,fN`; demais linhas: rótulo (texto) + N números. Para SERIE_TEMPORAL a janela vem achatada (canal-major por amostra: `ax0,ay0,az0,ax1,...`).
- `GET /datasets` → `{ id,nome,descricao,tipo,classes,janela,amostras,colunas,criadoEm }[]`. `POST /datasets` `{ nome, descricao?, tipo, janela?, csv: string }` → dataset (valida CSV, calcula classes/amostras/colunas, salva em `/data/datasets/<id>.csv`). `DELETE /datasets/:id` → 204. `GET /datasets/:id/amostra` → `{ cabecalho: string[], linhas: string[][] }` (20 primeiras). `GET /datasets/:id/csv` → download.
- `POST /agentes/:id/treinar` `{ datasetId, parametros?: Partial<ConfigTinyml> }` → `Treino` (FILA). Só TINYML. Envia ao trainer e muda para EXECUTANDO.
- `GET /treinos?agenteId=` → `TreinoResumo[]` (`{id,agenteId,datasetId,status,metricas,tamanhoBytes,criadoEm,finalizadoEm}`); `GET /treinos/:id` → completo com `log`; `GET /treinos/:id/modelo.tflite` e `GET /treinos/:id/model_data.h` → download.
- `POST /interno/treinos/:id` (interno) `{ status:'EXECUTANDO'|'SUCESSO'|'FALHA', log?: string /* acrescenta */, metricas?, modeloTflite?, modeloH?, tamanhoBytes? }` → 204. Em SUCESSO grava `configTinyml.ultimoTreinoId` no agente.

**projetos / builds / dispositivos (g07)**
- `GET /projetos` → `{ id,nome,slug,descricao,placa,framework,atualizadoEm, totalArquivos, ultimoBuild: {id,status,criadoEm}|null }[]`.
- `POST /projetos` `{ nome, descricao?, placa }` → projeto criado com arquivos-modelo da placa (`platformio.ini`, `src/main.cpp`, `include/README`, `lib/README`).
- `GET /projetos/:id` (id ou slug) → projeto + `arquivos: {caminho, atualizadoEm}[]`. `PUT /projetos/:id` `{nome?,descricao?,placa?}` (trocar placa reescreve só o `platformio.ini`). `DELETE /projetos/:id` → 204.
- `GET /projetos/:id/arquivos?conteudo=1` → `{caminho, atualizadoEm, conteudo?}[]`. `PUT /projetos/:id/arquivos` `{ arquivos: {caminho, conteudo}[], removerAusentes?: boolean }` → 204 (upsert em lote; usado pelo VS Code/MCP).
- `GET /projetos/:id/arquivo?caminho=src/main.cpp` → `{caminho, conteudo}`. `PUT /projetos/:id/arquivo` `{caminho, conteudo}` → 204. `DELETE /projetos/:id/arquivo?caminho=` → 204. Caminhos com `..`, `\` ou absolutos → 400.
- `POST /projetos/:id/build` `{ agenteId?: number }` → `Build` (FILA). Escreve os arquivos em `/data/projetos/<slug>/` (limpa antes), se `agenteId` tiver `ultimoTreinoId` copia `model_data.h` para `include/model_data.h`, chama o builder e muda para EXECUTANDO.
- `GET /builds?projetoId=` → `{id,projetoId,placa,status,tamanhoBytes,offset,criadoEm,finalizadoEm}[]`; `GET /builds/:id` → completo com `log`; `GET /builds/:id/firmware` → download do artefato.
- `POST /builds/:id/gravar` `{ porta: string }` → repassa ao builder `POST /gravar`; responde `{ ok: boolean, log: string }`. Atualiza `Dispositivo` com essa porta (se houver) `ultimoBuildId/ultimaGravacao`.
- `POST /interno/builds/:id` (interno) `{ status, log?, artefato?, offset?, tamanhoBytes? }` → 204.
- `GET/POST /dispositivos`, `PUT/DELETE /dispositivos/:id` (`{nome, placa, porta?, notas?}`).

### API do trainer (g05) e do builder (g07)
- Trainer `POST /treinos` `{ treinoId, csv: "/data/datasets/3.csv", saidaDir: "/data/treinos/7", config: ConfigTinyml, callbackUrl: "http://server:3333/api/interno/treinos/7", callbackToken }` → 202. Em segundo plano treina e chama o callback (header `X-Interno-Token`) com EXECUTANDO no início e SUCESSO/FALHA no fim. Grava `model.tflite` e `model_data.h` (`alignas(16) const unsigned char g_model[] = {...}; const unsigned int g_model_len = N;`). `GET /saude` → `{ok:true}`.
- Builder `POST /builds` `{ buildId, projetoDir: "/data/projetos/<slug>", placa, saidaDir: "/data/builds/<id>", callbackUrl, callbackToken }` → 202; roda `pio run -d <projetoDir>`, copia o artefato da tabela de placas, chama o callback. `POST /gravar` `{ artefato: "/data/builds/12/firmware-merged.bin", placa, porta, offset? }` → `{ ok, log }` (só funciona com a porta USB mapeada no container — Linux). `GET /saude`.

## 4. Cliente (client)

- Copiar a casca do `REF` (layout, ui, lib, tema, login) trocando prefixo de chaves `escola.` → `aicreator.`.
- `Perfil = 'ADMIN' | 'DEV' | 'LEITOR'`. `UsuarioLogado = { id, nome, email, perfil }`.
- Uma raiz só: **`/app`** para todos os perfis. `caminhoDoPerfil()` → `'/app'`. `nomePortal`: ADMIN→"Administrador", DEV→"Desenvolvedor", LEITOR→"Leitor".
- Módulos: `client/src/modules/<modulo>/index.tsx` exportando `export const rotas: RotaModulo[]` (mesmo tipo do REF). `App.tsx` junta por `import.meta.glob` como no REF.
- Componentes de `client/src/ui/index.tsx` (mesmas assinaturas do REF): `Pagina, Cartao, Grade, Botao, Selo, Aviso, Carregando, Tabela, ColunaTabela, Avatar, Campo, AreaTexto, Selecao, Caixa, Modal, Abas, MenuAcoes, AcaoMenu, formatarData, formatarDataHora, paraInputData`. `MenuAcoes` passa a morar em `client/src/ui/MenuAcoes.tsx`.
- Hooks: `useDados<T>(caminho)` e `api.get/post/put/del` iguais ao REF. Para SSE use `client/src/lib/sse.ts`:
  `export async function lerEventos(caminho: string, corpo: unknown, aoEvento: (e: unknown) => void, sinal?: AbortSignal): Promise<void>` (POST com token, lê o corpo em stream e chama `aoEvento(JSON.parse(...))` por linha `data:`).
- Ícones (`NomeIcone`): **todos** os do REF continuam existindo, mais estes novos: `robo, cerebro, chip, pasta, codigo, martelo, usb, dados, terminal, chave, plugin, download, upload, copiar, historicoVersoes, play, parar`.
- Grupos do menu (`client/src/layout/grupos.ts`):
  `'' [inicio]` · `Agentes [robo, cerebro]` · `Firmware [pasta, martelo, chip]` · `Dados [dados]` · `Integrações [plugin]` · `Sistema [usuarios, log, engrenagem]` · `Conta [chave]`.

### Rotas de tela (todas `perfis: ['ADMIN','DEV','LEITOR']` salvo indicação)

| Caminho | Módulo (dono) | Ícone | Ordem | menu |
|---|---|---|---|---|
| `/app` | inicio (g02) | inicio | 0 | sim |
| `/app/agentes` | agentes (g04) | robo | 10 | sim — rótulo "Agentes LLM" (lista filtrada tipo LLM) |
| `/app/tinyml` | agentes (g04) | cerebro | 11 | sim — rótulo "Agentes TinyML" (mesma lista, tipo TINYML) |
| `/app/agentes/novo` | agentes (g04) | robo | — | não (`?tipo=LLM|TINYML`) |
| `/app/agentes/:id` | agentes (g04) | robo | — | não |
| `/app/projetos` | firmware (g08) | pasta | 20 | sim — "Projetos" |
| `/app/projetos/:id` | firmware (g08) | pasta | — | não (editor + builds) |
| `/app/builds` | firmware (g08) | martelo | 21 | sim — "Compilações" |
| `/app/dispositivos` | firmware (g08) | chip | 22 | sim — "Dispositivos" |
| `/app/datasets` | tinyml (g06) | dados | 30 | sim — "Datasets" |
| `/app/integracoes` | sistema (g06) | plugin | 40 | sim — "VS Code e Claude Code" |
| `/app/usuarios` | sistema (g06) | usuarios | 50 | sim, só ADMIN |
| `/app/logs` | sistema (g06) | log | 51 | sim, só ADMIN |
| `/app/configuracoes` | sistema (g06) | engrenagem | 52 | sim, só ADMIN |
| `/app/tokens` | sistema (g06) | chave | 60 | sim — "Tokens de API" |

### Componentes compartilhados entre módulos do cliente
- `client/src/modules/tinyml/componentes.tsx` (g06) exporta:
  - `export function FormularioTinyml({ valor, aoMudar, somenteLeitura }: { valor: ConfigTinyml; aoMudar: (v: ConfigTinyml) => void; somenteLeitura?: boolean })`
  - `export function AbaTreino({ agenteId, config }: { agenteId: number; config: ConfigTinyml })` (escolher dataset, treinar, acompanhar com polling de 3 s, métricas, matriz de confusão, downloads).
- `client/src/lib/tipos-api.ts` (g02) exporta os tipos TypeScript de §2/§3: `Placa, PLACAS: {valor: Placa; rotulo: string}[], StatusJob, ConfigTinyml, CONFIG_TINYML_PADRAO, AgenteResumo, Agente, MensagemChat, Dataset, TreinoResumo, Treino, ProjetoResumo, Projeto, ArquivoInfo, BuildResumo, Build, Dispositivo, TokenApiInfo, rotuloStatus(s: StatusJob): string, corStatus(s: StatusJob): 'verde'|'amarelo'|'vermelho'|'azul'|'cinza'` (cores de `Selo`: FILA→cinza, EXECUTANDO→azul, SUCESSO→verde, FALHA→vermelho, CANCELADO→amarelo).

## 5. Integrações
- Extensão VS Code (`extensions/vscode/`, g09) e servidor MCP (`integrations/claude-code/mcp-server/`, g09) falam **só** com a API HTTP acima usando token `aic_`.
- Config: URL base (padrão `http://localhost:8080`, as chamadas vão para `<url>/api/...`) e token.
