# Contratos — melhorias (leva A)

Complementa `CONTRATOS.md` e `CONTRATOS-MODELOS.md` (continuam valendo: módulos carregados por `app.ts`, `autenticar` em toda rota exceto `/interno/*`, erros `{erro}`, português).
Escritos pelo main, **somente leitura** para os geradores:
- `server/prisma/schema.prisma` (novos: `Usuario.trocarSenha`, `Plataforma.precosLlm`, modelo `UsoLlm`, e em `Treino`/`TreinoModelo`/`Build` os campos `tentativas` e `atualizadoEm`; `Build.iniciadoEm`)
- `client/src/lib/tipos-modelos.ts` (tarefa `AUDIO`, dataset `SONS`, `entrada.audio`) e `client/src/lib/tipos-melhorias.ts` (tipos desta leva)
- `server/src/modules/llm/provedores/ferramentas-tipos.ts` e `anthropic-ferramentas.ts` (laço de ferramentas do Claude, pronto)

Geradores e itens: A01 fila+eventos (servidor) · A02 serviços Python (ativos, prever, imagem menor) · A03 segurança · A04 testes e CI · A05 monitor serial + coleta + modelos de firmware · A06 testar modelo + uso de tokens · A07 eventos ao vivo no cliente · A08 rotas preguiçosas + menu · A09 agente com ferramentas · A10 áudio (KWS).

## 1. Fila no Postgres e vigia (A01)

Estados continuam `FILA → EXECUTANDO → SUCESSO|FALHA|CANCELADO`. **Nenhuma rota chama mais o serviço diretamente**: as rotas só criam a linha em `FILA` e chamam `acordarFila()`. O despachante envia.

`server/src/modules/fila/despachante.ts`:
- `export function acordarFila(): void` — agenda um ciclo imediato (sem sobrepor).
- `export function iniciarFila(): void` — idempotente; ciclo a cada 3 s. Não faz nada se `process.env.FILA_DESLIGADA === '1'` (testes).
- Serviços e capacidade (vagas simultâneas, por env): `trainer` = `FILA_TRAINER` (1), `builder` = `FILA_BUILDER` (2), `finetuner` = `FILA_FINETUNER` (1), `openai` = 5.
  - `Treino` (agente TinyML) → trainer; `TreinoModelo` TINYML/TABULAR → trainer; LLM_LOCAL → finetuner; LLM_NUVEM → openai; `Build` → builder.
- Ciclo: para cada serviço, `vagas = capacidade − (EXECUTANDO daquele serviço)`; pega os `FILA` mais antigos (`criadoEm` asc) e, para cada um, `updateMany({ where:{id, status:'FILA'}, data:{status:'EXECUTANDO', iniciadoEm: new Date()} })` (se `count === 0`, outro ciclo pegou) e chama o envio (os mesmos pedidos HTTP de hoje: `treinos/routes.ts enviarAoTrainer`, `projetos/routes.ts` chamada ao builder, `treinos-modelo/despachar.ts`). Mova a lógica de envio para funções exportadas `enviarTreinoAgente(id)`, `enviarBuild(id)` (novo `server/src/modules/projetos/build.ts`) e `despacharTreino(id)` (já existe; deixa de checar `FILA` e passa a receber a linha já em EXECUTANDO).
- Serviço fora do ar (erro de conexão / timeout / HTTP 5xx): volta para `FILA` com `tentativas += 1` e log `"Serviço <nome> indisponível; nova tentativa em instantes (n/20)."`; só tenta de novo depois de 15 s (`atualizadoEm`). Com `tentativas >= 20` → `FALHA` com as mensagens antigas ("Serviço de treino indisponível", etc.).
- HTTP 4xx do serviço → `FALHA` com o corpo da resposta no log.

`server/src/modules/fila/vigia.ts`:
- `export function iniciarVigia(): void` — idempotente; roda 10 s após subir e depois a cada 60 s (desligado com `FILA_DESLIGADA=1`).
- Para trainer/builder/finetuner: `GET <url>/trabalhos` (timeout 3 s) → `{ treinos: number[], treinosModelo: number[], builds: number[] }` (ids **ativos** no serviço). Cada linha `EXECUTANDO` daquele serviço que **não** está na lista e cujo `atualizadoEm` tem mais de 2 min → `FALHA` com log `"O serviço <nome> reiniciou e o trabalho foi perdido. Rode de novo."`.
- Tempo limite (desde `iniciadoEm`), mesmo com o serviço fora: build 30 min, treino trainer 2 h, LLM_LOCAL 12 h → `FALHA` `"Tempo limite excedido (<x>)."`. LLM_NUVEM fica com o worker da OpenAI.
- Sempre com `updateMany` e `status: 'EXECUTANDO'` no `where` (não sobrescrever o que mudou).
- `server/src/modules/fila/routes.ts`: chama `iniciarFila()` e `iniciarVigia()` no topo e expõe `GET /fila` (autenticar) → `{ servicos: { nome, capacidade, executando, naFila, online: boolean }[] }` e `GET /eventos` (SSE, §2).
- Rotas alteradas para só enfileirar: `POST /agentes/:id/treinar`, `POST /projetos/:id/build`, `POST /modelos/:id/treinar` (todas respondem 201/202 com a linha em `FILA`). `POST /projetos` aceita `modelo?: 'BLINK' | 'COLETOR' | 'OTA'` e passa para `arquivosModelo(placa, nome, modelo)` (A05 implementa os modelos; `OTA` ainda cai em BLINK até a leva B).
- `server/src/modules/projetos/build.ts`: `export async function criarBuild(projetoId: number, opcoes: { agenteId?: number; modeloTreinoId?: number }, usuarioId: number | null): Promise<Build>` (valida, escreve os arquivos em disco como hoje, cria a linha em FILA, `acordarFila()`, emite evento) e `export async function enviarBuild(buildId: number): Promise<'ok' | 'indisponivel' | { erro: string }>`. A rota `POST /projetos/:id/build` passa a chamar `criarBuild`. **A09 usa `criarBuild`.**

## 2. Eventos ao vivo (A01 servidor, A07 cliente)

- `server/src/lib/eventos.ts`: `export function emitirEvento(e: Omit<EventoTrabalho,'em'>): void` e `export function ouvirEventos(fn): () => void` (EventEmitter com `setMaxListeners(0)`). `EventoTrabalho` igual a `client/src/lib/tipos-melhorias.ts`.
- Emitir em **toda** mudança de status ou de log/métricas: criação (FILA), despachante, callbacks internos (`treinos`, `builds`, `treinos-modelo`), cancelar, vigia, worker OpenAI (`openai.ts` → dentro de `registrar` e da escrita final de `sincronizarUm`).
- `GET /eventos` (autenticar): SSE, cabeçalhos como em `llm/routes.ts`, `: ping\n\n` a cada 25 s, `data: <EventoTrabalho JSON>\n\n` por evento; remove o ouvinte no `close`.
- Cliente (A07): `client/src/lib/eventos.ts` com **uma** conexão compartilhada (fetch + `getReader`, token no header, reconexão com espera 1 s → 2 s → 5 s → 10 s; só conecta enquanto houver assinante) e `export function useEventosTrabalho(filtro: (e: EventoTrabalho) => boolean, aoEvento: (e: EventoTrabalho) => void): void`. Telas recarregam os dados quando chega um evento que interessa; polling de segurança passa a 20 s.

## 3. Serviços Python (A02)

- `GET /trabalhos` em trainer, builder e finetuner → `{ treinos: [], treinosModelo: [], builds: [] }` com os ids em andamento. Cada serviço guarda um `set` por tipo (com `threading.Lock`), adiciona ao aceitar o pedido e remove no `finally` depois que o processo filho terminar (em `app/ativos.py` de cada serviço).
- Trainer `POST /modelos/prever` (síncrono, timeout do servidor 30 s): `{ tipo: 'TINYML'|'TABULAR', tarefa, artefatos: { tflite?: str, joblib?: str, metricas: str }, config: dict, entrada: { valores?: number[], imagemBase64?: str, audioBase64?: str } }` → `ResultadoPrevisao` (`tipos-melhorias.ts`). TINYML: `tf.lite.Interpreter`, aplica a mesma normalização do treino (lida do `metricas.json`; confira as chaves em `trainer/app/treino.py` e `trainer/app/modelos/tinyml.py`), quantiza a entrada int8 com `scale/zero_point` do tensor, desquantiza a saída; IMAGEM decodifica com `tf.io.decode_image`, converte para cinza/RGB e redimensiona para `entrada.imagem`; AUDIO usa `app.modelos.audio.extrair_features_audio(wav_bytes, cfg_audio)` (A10). Regressão: devolve `valor` desnormalizado. TABULAR: `joblib.load`, `predict`/`predict_proba`. Erros de entrada → HTTP 400 `{detail: "mensagem em português"}`.
- Imagem menor: `tensorflow-cpu==2.16.2` no lugar de `tensorflow` e `tf-keras==2.16.0` instalado com `pip install --no-deps` (para não puxar o `tensorflow` completo). Medir antes/depois (`docker images`) e provar que a conversão INT8 continua funcionando no container.

## 4. Segurança (A03)

- `server/src/lib/segredos.ts`: `export function segredo(nome: 'JWT_SECRET' | 'INTERNO_TOKEN'): string` — usa o env se definido **e** diferente dos valores de exemplo (`troque-este-segredo`, `troque-token-interno`, `troque-este-segredo-de-exemplo`, vazio); senão lê/gera (32 bytes hex) e grava em `<DATA_DIR>/segredos.json` (modo 0600) e loga um aviso uma vez. `config.ts` usa `segredo(...)` para `jwtSegredo` e `internoToken`.
- `Usuario.trocarSenha`: seed cria o admin com `trocarSenha: true` quando a senha é a padrão (`ADMIN_SENHA` ausente); admin criando usuário ou trocando a senha de outro → `true`.
- Login e `GET /auth/eu` devolvem `usuario.trocarSenha: boolean`. `POST /auth/trocar-senha` (autenticar) `{ senhaAtual, novaSenha }` (nova: mínimo 8, diferente da atual e do e-mail) → `{ token, usuario }` com `trocarSenha: false`.
- Cliente: `UsuarioLogado.trocarSenha?: boolean`; `useAuth()` ganha `trocarSenha(senhaAtual, novaSenha): Promise<void>`; tela `client/src/layout/TrocarSenha.tsx` (`export function TrocarSenha()`, visual do Login) em `/trocar-senha` (rota e redirecionamento: A08); item "Trocar senha" no `MenuUsuario`.

## 5. Testes e CI (A04)

- Servidor: `vitest@2.1.8` + `supertest@7.0.0` (+ `@types/supertest@6.0.2`), `server/test/*.test.ts`, banco de teste por `DATABASE_URL` (no CI: serviço postgres 16). `FILA_DESLIGADA=1`. Script `npm test` = `prisma db push --skip-generate --force-reset && vitest run`.
- E2E: `e2e/` com `@playwright/test@1.49.1`, `baseURL http://localhost:8080`, sobe com `docker compose up -d --build db server client` e `ADMIN_SENHA=senha-e2e-123` (sem troca forçada).
- CI: jobs novos `server-testes` e `e2e` em `.github/workflows/ci.yml`.

## 6. Firmware: monitor serial, coleta, modelos (A05)

- `server/src/modules/projetos/modelos.ts`: `arquivosModelo(placa, nome, modelo: 'BLINK' | 'COLETOR' | 'OTA' = 'BLINK')`. COLETOR: imprime `# AIC-COLETA canais=<n> hz=<hz> nomes=<a,b,c>` no `setup` e a cada 2 s, e linhas `v1,v2,v3` a `hz` (padrão 50); ESP32/S3 tenta MPU6050 (I2C 0x68, sem biblioteca externa, registradores direto) e, sem ele, lê 3 entradas analógicas; demais placas leem 3 analógicas. `OTA` → por enquanto igual a BLINK.
- Componentes (cliente, `client/src/modules/firmware/`): `serial.ts` (`class ConexaoSerial` com `abrir(baud)`, `fechar()`, `escrever(texto)`, `aoLinha(cb)`; trata ausência de `navigator.serial`), `MonitorSerial.tsx` (`export function MonitorSerial({ compacto }: { compacto?: boolean })`, `export function MonitorSerialPagina()` para a rota), `Coleta.tsx` (`export function Coleta()`) com **modo simulador** (gera sinais de "parado", "acenar" e "circulo" sem placa).
- Rotas (registradas pelo A08): `/app/serial` (rótulo "Monitor serial", ícone `terminal`, ordem 23) e `/app/coleta` (rótulo "Coletar dados", ícone `upload`, ordem 31).

## 7. Testar modelo e uso (A06)

- `POST /treinos-modelo/:id/prever` (autenticar, todos os perfis) → `ResultadoPrevisao`. Novo módulo `server/src/modules/prever/routes.ts`; só SUCESSO de TINYML/TABULAR; repassa ao trainer (`/modelos/prever`) com caminhos absolutos (`path.resolve(config.dataDir, artefato.caminho)`).
- `server/src/modules/uso/registrar.ts`: `export async function registrarUso(p: { agenteId: number | null; usuarioId: number | null; provedor: string; modelo: string; entrada: number; saida: number; ferramentas?: number }): Promise<{ custoUsd: number | null }>` (nunca lança). Preços padrão em `uso/precos.ts` (USD/1M: `claude-opus-5-5` 4/20, `claude-sonnet-5-5` 2/10, `claude-haiku-5-5` 0.10/0.50, `claude-fable-5-2` 8/40, `claude-opus-5` 5/25); `Plataforma.precosLlm` sobrescreve/acrescenta; modelos do Ollama custam 0.
- `GET /uso/resumo?dias=30` → `ResumoUso`; `GET /uso/precos` → `{ padrao: PrecosLlm, personalizados: PrecosLlm }`; `PUT /uso/precos` (ADMIN) `{ precos: PrecosLlm }`.
- Cliente: `client/src/modules/modelos/AbaTestar.tsx` (`export function AbaTestar({ modelo, treinos }: { modelo: Modelo; treinos: TreinoModeloResumo[] })`) — a aba é encaixada pelo A07 no `Detalhe.tsx`; `client/src/modules/sistema/Uso.tsx` (`export function Uso()`), rota `/app/uso` (rótulo "Uso e custos", ícone `grafico`, ordem 53, ADMIN e DEV) registrada pelo A08.

## 8. Agente com ferramentas (A09)

- Ligado quando `Agente.ferramentas` contém nomes de `FERRAMENTAS_PLATAFORMA` (`aic.*`) **e** o agente tem `projetoId`. Para o modelo os nomes viram `listar_arquivos`, `ler_arquivo`, `escrever_arquivo`, `compilar`.
- `server/src/modules/llm/ferramentas.ts`: `export function ferramentasDoAgente(agente): DefinicaoFerramenta[]` e `export function criarExecutorFerramentas(projetoId: number, usuarioId: number): (nome, entrada) => Promise<ResultadoFerramenta>`; caminhos com `validarCaminho` de `projetos/caminhos.ts`; `compilar` usa `criarBuild` (A01) e espera o fim ouvindo `ouvirEventos` (limite 10 min), devolvendo status + últimas 80 linhas do log.
- `llm/routes.ts` (`POST /agentes/:id/executar`): com ferramentas → ANTHROPIC usa `executarAnthropicComFerramentas` (pronto); OPENAI usa `executarOpenaiComFerramentas` (A09, `provedores/openai-ferramentas.ts`, mesmo contrato, Chat Completions com `tools`); OLLAMA sem ferramentas (envia `{tipo:'texto'}` avisando e segue sem). Repassa os eventos `ferramenta`. No fim chama `registrarUso` (A06) e envia `{ tipo:'fim', uso:{ entrada, saida, custoUsd } }` — em **todas** as execuções, com ou sem ferramentas.
- `agentes/formatoMd.ts`: `aic.*` não vão para o `.md` do Claude Code.

## 9. Interface (A08)

- Cada `client/src/modules/*/index.tsx` usa `lazy()` para as telas; `App.tsx` envolve as rotas em `<Suspense fallback={<Carregando />}>`; `vite.config.ts` com `manualChunks` (`react`, `react-dom`, `react-router-dom` num chunk `vendor`). Meta: chunk principal < 250 KB.
- Rota `/trocar-senha` (fora do Layout) e, se `usuario.trocarSenha`, qualquer outra rota redireciona para ela.
- `grupos.ts`: `terminal` no grupo Firmware, `upload` em Dados, `grafico` em Sistema.

## 10. Áudio / palavra-chave (A10)

- Dataset `SONS`: `.zip` com uma pasta por classe e `.wav` (PCM 16 bits; qualquer taxa — o trainer reamostra). Mesmos limites do zip de imagens; `GET /datasets/:id/audio?caminho=` devolve o `.wav`; amostra `formato:'SONS'`.
- Tarefa TINYML `AUDIO` (dataset SONS), arquitetura `DS_CNN`; padrão `entrada.audio = { taxaHz:16000, duracaoMs:1000, janelaMs:30, passoMs:20, canaisMel:40 }`, `epocas 40`, `taxaAprendizado 0.003`, `tamanhoLote 16`, `aumentoDados true` (deslocamento no tempo + ruído), placa ESP32S3.
- `trainer/app/modelos/audio.py`: `extrair_features_audio(wav_bytes: bytes, audio: dict) -> np.ndarray` (frames × canaisMel, uint8/float) usando o micro-frontend do TFLite (`tensorflow.lite.experimental.microfrontend.python.ops.audio_microfrontend_op`) — o mesmo do exemplo micro_speech do TFLite Micro, para a placa calcular igual; se não existir no pacote, cair para log-mel com `tf.signal` e avisar no log que a placa precisará do mesmo cálculo. Também gera `features_audio.h` com `#define`s dos parâmetros.
