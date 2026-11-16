# A09 — Agente LLM com ferramentas da plataforma

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §8, os arquivos prontos do main `server/src/modules/llm/provedores/ferramentas-tipos.ts` e `anthropic-ferramentas.ts` (não edite), `server/src/modules/llm/routes.ts`, `provedores/openai.ts` e `client/src/lib/tipos-melhorias.ts` (`FERRAMENTAS_PLATAFORMA`, `EventoExecucao`).

## Arquivos (só estes)
- servidor: `server/src/modules/llm/ferramentas.ts` (novo), `server/src/modules/llm/provedores/openai-ferramentas.ts` (novo), `server/src/modules/llm/routes.ts`, `server/src/modules/agentes/formatoMd.ts`
- cliente: `client/src/modules/agentes/FormularioLlm.tsx`, `client/src/modules/agentes/Playground.tsx`, `client/src/modules/agentes/agentes.css`

Usa de outros: `criarBuild` (A01, `../projetos/build`), `ouvirEventos` (A01, `../../lib/eventos`), `registrarUso` (A06, `../uso/registrar`), `validarCaminho` (`../projetos/caminhos`).

## Passos
1. `ferramentas.ts`: 4 definições (`listar_arquivos` sem entrada; `ler_arquivo {caminho}`; `escrever_arquivo {caminho, conteudo}` até 200 KB; `compilar {}`), com JSON Schema e zod. Executor: lê/grava `ArquivoProjeto` do projeto vinculado (upsert), recusa `platformio.ini`? **Não** — permite, mas registra log `agente.escrever-arquivo`. `compilar`: `criarBuild(projetoId, {}, usuarioId)` e espera o evento final (`SUCESSO/FALHA/CANCELADO`) até 10 min; resultado: status, tamanho e as últimas 80 linhas do log (do banco).
2. `openai-ferramentas.ts`: mesmo contrato `ExecutorComFerramentas`, Chat Completions **sem** stream nas rodadas com ferramentas (`tools: [{type:'function', function:{name, description, parameters}}]`, laço até não haver `tool_calls`, respostas `role:'tool'` com `tool_call_id`), envia o texto final por `aoTexto`; soma `usage`.
3. `llm/routes.ts`: decidir com/sem ferramentas (§8); repassar eventos `ferramenta` pelo SSE; `registrarUso` no fim de **toda** execução (com o `custoUsd` no evento `fim`); Ollama com ferramentas pedidas → aviso de texto e segue sem.
4. `formatoMd.ts`: filtrar `aic.*` em `paraMarkdown`; na importação, manter as que já existiam no agente (não apagar `aic.*` ao reimportar).
5. Cliente: em `FormularioLlm.tsx`, seção "Ferramentas da plataforma" com os 4 itens (`FERRAMENTAS_PLATAFORMA`), desabilitada com explicação se o agente não tem projeto vinculado; em `Playground.tsx`, mostrar as chamadas como cartões recolhíveis no meio da conversa (ícone, nome, entrada resumida, resultado/erro) e o custo no rodapé ("US$ 0,0123" ou "sem preço cadastrado").

## Verificação
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit && npx vite build`.
- Script `tsx` temporário que chama o executor de ferramentas de `ferramentas.ts` com um prisma de verdade? Não há banco local: teste as funções puras (validação de caminho, corte de conteúdo, montagem das definições) e o laço da OpenAI contra um servidor HTTP falso (ex.: 1ª resposta pede `ler_arquivo`, 2ª responde texto). Publique.
