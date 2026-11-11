# m01 — Servidor: CRUD de modelos, opções e datasets novos

Leia: `CONTRATOS.md` (§3 convenções) e `CONTRATOS-MODELOS.md` (§1–§4 "modelos" e "datasets"). Schema pronto (só leitura).

## Arquivos (só estes)
- `server/src/modules/modelos/{routes,esquemas,padroes,opcoes,comum}.ts`
- `server/src/modules/datasets/routes.ts`, `server/src/modules/datasets/arquivos.ts` (novo)
- `server/src/lib/config.ts` — **só** acrescentar `finetunerUrl` (`FINETUNER_URL`, padrão `http://finetuner:8003`)
- `server/package.json` — **só** acrescentar `"adm-zip": "0.5.16"` e, em dependências, `"@types/adm-zip": "0.5.7"` (depois `npm install` em `server/`)

## Passos
1. `padroes.ts`: `export function configPadrao(tipo, tarefa): ConfigModelo` (valores do §2), `export const TAREFAS_POR_TIPO`, `export const DATASETS_POR_TIPO` (tabela §1) e os tipos TS (copie as interfaces de config de `client/src/lib/tipos-modelos.ts`).
2. `esquemas.ts`: zod para criar/atualizar modelo e para cada config (limites do `tipos-modelos.ts`; `sufixo` regex `^[a-z0-9-]{0,18}$`; `nomeOllama` regex `^[a-z0-9][a-z0-9._:-]{0,63}$` ou vazio).
3. `comum.ts`: `buscarModelo(idOuSlug)` (404 "Modelo não encontrado"), `paraResumo`, `paraModelo` (formatos `ModeloResumo`/`Modelo`), `paraTreinoResumo(t)` e `paraTreino(t)` (`tamanhoBytes` = soma dos artefatos TFLITE/JOBLIB/ADAPTER; `null` se nenhum), `validarCompatibilidade(tipo, tarefa, datasetTipo?)` (ErroHttp 400 com mensagem clara). **O m02 importa essas funções** — mantenha os nomes.
4. `opcoes.ts`: `export async function obterOpcoes(): Promise<OpcoesModelos>` conforme §3.
5. `routes.ts`: rotas de modelos do §4 (`/modelos/opcoes` antes de `/modelos/:id`). Slug com `slugUnico`. Logs com `registrar`. DELETE apaga `caminhoDados('modelos', String(id))` (`fs.rmSync(..., {recursive:true, force:true})`).
6. Datasets (§4 "datasets"): em `arquivos.ts` as funções `salvarImagensZip(id, buffer)` e `validarConversas(texto)`; em `routes.ts` a rota `POST /datasets/arquivo` (com `express.raw` local), o novo formato de `GET /datasets/:id/amostra` (acrescente `formato`), `GET /datasets/:id/imagem` e `GET /datasets/:id/arquivo`. `DELETE /datasets/:id` também apaga pasta/jsonl. **Mantenha `autenticar` em todas as rotas** e não quebre as rotas CSV existentes.

## Verificação
- `cd server && npx tsc --noEmit` sem erros.
- Script temporário (na pasta do scratchpad) que chama `validarConversas` com um JSONL válido de 10 linhas e um inválido (linha 3 sem assistant), e `salvarImagensZip` com um zip gerado por `adm-zip` (2 classes × 2 PNG mínimos) num `DATA_DIR` temporário. Publique o resultado.
