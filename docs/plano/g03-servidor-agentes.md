# g03 — Servidor: agentes e LLM

Leia antes: `docs/plano/CONTRATOS.md` (§2 ConfigTinyml, §3 "agentes / llm" e formato `.md`). As libs comuns (`lib/*`) são do g01 — importe pelas assinaturas do contrato mesmo que ainda não existam.

## Arquivos que você pode criar/editar (só estes)
- `server/src/modules/agentes/routes.ts`, `server/src/modules/agentes/formatoMd.ts`, `server/src/modules/agentes/esquemas.ts`, `server/src/modules/agentes/padroes.ts`
- `server/src/modules/conversas/routes.ts`
- `server/src/modules/llm/routes.ts`, `server/src/modules/llm/executar.ts`, `server/src/modules/llm/provedores/openai.ts`, `server/src/modules/llm/provedores/ollama.ts`
NÃO edite `llm/provedores/tipos.ts` nem `llm/provedores/anthropic.ts` (prontos, do main — leia e use).

## Passos
1. `agentes/padroes.ts`: `export const CONFIG_TINYML_PADRAO` (valor do contrato) e tipo `ConfigTinyml`.
2. `agentes/esquemas.ts`: zod `AgenteEntrada` (e parcial para PUT com `nota`), `ConfigTinyml` validado com os limites do contrato. `esforco` ∈ low|medium|high|xhigh|max; `temperatura` 0..2; `maxTokens` 1..128000.
3. `agentes/formatoMd.ts`: `export function paraMarkdown(a: Agente): string` e `export function deMarkdown(texto: string): AgenteEntrada` (parser de frontmatter YAML simples linha a linha `chave: valor` entre `---`; sem dependência nova). Regras de mapeamento de modelo exatamente as do contrato. Teste mental: exportar e importar de volta preserva nome-slug, descrição, prompt e ferramentas.
4. `agentes/routes.ts`: todas as rotas de agentes do contrato. `:id` aceita número ou slug (helper `buscarAgente(idOuSlug)` → 404 "Agente não encontrado"). Slug único com `slugUnico`. Toda alteração grava `VersaoAgente` com `snapshot` = agente completo serializado (sem relações) e incrementa `versao`. `autorId` = usuário logado na criação. Registre logs.
5. `llm/provedores/openai.ts`: `export const executarOpenai: Executor` usando `fetch('https://api.openai.com/v1/chat/completions', { stream: true })` com `Authorization: Bearer ${config.openaiChave}`; lê SSE (`data: {...}` / `data: [DONE]`), chama `aoTexto(delta.content)`, usa `stream_options: {include_usage: true}` para o uso. Erro claro se a chave faltar. `export const MODELOS_OPENAI = ['gpt-5', 'gpt-5-mini', 'gpt-4.1']`.
6. `llm/provedores/ollama.ts`: `executarOllama: Executor` com `POST {ollamaUrl}/api/chat` `{model, messages:[{role:'system',...}, ...], stream:true, options:{temperature, num_predict}}` (NDJSON: uma linha JSON por pedaço, `message.content`, `done`, `prompt_eval_count`, `eval_count`). `listarModelosOllama(): Promise<string[]>` com timeout 2 s.
7. `llm/executar.ts`: `export function executorDe(p: 'ANTHROPIC'|'OPENAI'|'OLLAMA'): Executor`.
8. `llm/routes.ts`: `GET /llm/modelos`, `GET /llm/status` (contrato) e `POST /agentes/:id/executar` (SSE): cabeçalhos `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`, `res.flushHeaders()`. `AbortController` abortado em `req.on('close')`. Envia `{tipo:'texto'}` a cada pedaço, `{tipo:'fim', uso}` no final, `{tipo:'erro', erro}` em falha, e encerra. Valide `mensagens` (1..200, último `role` = `user`). LEITOR pode executar? **Não**: exige ADMIN/DEV. Registre log "Executou agente".
9. `conversas/routes.ts`: rotas de conversas do contrato.

## Aceite / verificação
- `cd server && npx tsc --noEmit` sem erros nos seus arquivos (se o g01 ainda não tiver criado `lib/*` ou `package.json`, espere: `BUS wait` e pergunte `@main`).
- Escreva um script temporário em `<pasta temporária>` que faz ida e volta `paraMarkdown`/`deMarkdown` e rode com `npx tsx` a partir de `server/`. Publique o resultado.
