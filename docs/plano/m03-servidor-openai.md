# m03 — Servidor: ajuste fino na OpenAI

Leia: `CONTRATOS-MODELOS.md` §4 "OpenAI" (é a sua especificação inteira) e §1.

## Arquivos (só estes)
- `server/src/modules/treinos-modelo/openai.ts`, `server/src/modules/treinos-modelo/worker.ts`

## Passos
1. `openai.ts` com `iniciarAjusteOpenai`, `sincronizarAjustesOpenai` e `cancelarAjusteOpenai` exatamente como no contrato. Use `fetch`, `FormData` e `Blob` nativos do Node 20 (`new Blob([buffer], { type: 'application/jsonl' })`, `form.append('file', blob, 'treino.jsonl')`, `form.append('purpose', 'fine-tune')`). Erros: leia `json.error.message`.
2. Isole a parte HTTP em funções puras testáveis: `enviarArquivo(buffer)`, `criarJob(params)`, `lerJob(id)`, `lerEventos(id)`, `cancelarJob(id)`, usando `let BASE_OPENAI = 'https://api.openai.com/v1'` e `export function definirBaseOpenai(url: string)` (só para teste). Header `Authorization: Bearer ${config.openaiChave}`. Nada de SDK novo.
3. Para acrescentar log/metricas, atualize o `TreinoModelo` direto com Prisma (`log: atual.log + novo`). Ao finalizar grave `finalizadoEm`.
4. `worker.ts`: `iniciarWorkerOpenai()` idempotente (variável de módulo), intervalo 30 s, flag `rodando` para não sobrepor, `try/catch` com `console.error`. Cada ciclo retorna cedo se `config.openaiChave` estiver vazio.
5. Comentários curtos em português explicando o fluxo.

## Verificação
- `cd server && npx tsc --noEmit` sem erros nos seus arquivos.
- Script temporário (scratchpad, rode com `npx tsx` a partir de `server/`) que sobe um `http.createServer` imitando `/v1/files`, `/v1/fine_tuning/jobs`, `/v1/fine_tuning/jobs/:id`, `.../events` e `.../cancel`, chama `definirBaseOpenai` e exercita as funções puras. Publique a saída.
