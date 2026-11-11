# m02 — Servidor: treinos de modelo, callbacks e builds

Leia: `CONTRATOS-MODELOS.md` (§1, §4 "treinos de modelo" e "Builds", §5 e §6 só a parte do pedido HTTP).

## Arquivos (só estes)
- `server/src/modules/treinos-modelo/routes.ts`, `server/src/modules/treinos-modelo/despachar.ts`
- `server/src/modules/projetos/routes.ts` (só a rota `POST /projetos/:id/build`: aceitar `modeloTreinoId`)

Importa de outros (não edite): `../modelos/comum` (m01: `buscarModelo`, `paraTreino`, `paraTreinoResumo`, `validarCompatibilidade`), `./openai` (m03: `iniciarAjusteOpenai`, `cancelarAjusteOpenai`), `./worker` (m03: `iniciarWorkerOpenai`). Se ainda não existirem, escreva pelo contrato e rode o typecheck quando aparecerem.

## Passos
1. `despachar.ts`: `export async function despacharTreino(treinoId: number): Promise<void>` — monta o pedido do trainer (§5: `dataset.caminho` absoluto via `caminhoDados(dataset.caminhoArquivo)`, `saidaDir = caminhoDados('modelos', String(modeloId), 'treinos', String(numero))` criando a pasta, `callbackUrl = config.serverUrlInterno + '/api/interno/treinos-modelo/' + id`) ou do finetuner (§6, `nomeOllama` padrão `aic-<slug>-v<numero>`, `ollamaUrl = config.ollamaUrl`) ou chama `iniciarAjusteOpenai`. Marca EXECUTANDO antes; em erro de conexão marca FALHA com as mensagens do contrato (timeout 10 s).
2. `routes.ts`: chame `iniciarWorkerOpenai()` no topo do módulo; todas as rotas de treinos de modelo do §4 (treinar, listar, detalhe, cancelar, publicar, artefatos, criar-agente, interno). `criar-agente`: crie o agente com `prisma.agente.create` + `prisma.versaoAgente.create` numa transação; slug com `slugUnico(gerarSlug(nome), ...)`; registre log.
3. Callback interno: mescla `metricas` (objeto) sobre o existente, acrescenta `log`, substitui `artefatos` quando vier, grava `finalizadoEm` em SUCESSO/FALHA/CANCELADO; ignora se já CANCELADO.
4. `projetos/routes.ts` (build): aceitar `modeloTreinoId` além de `agenteId`; validar (treino SUCESSO de modelo TINYML/TABULAR, senão 400); depois de escrever os arquivos do projeto, copiar cada artefato `HEADER_C` para `include/<nome>`; gravar `modeloTreinoId` no Build. Não mude mais nada nesse arquivo.

## Verificação
- `cd server && npx tsc --noEmit` sem erros (quando m01/m03 tiverem entregado).
- Mostre no grupo o trecho alterado de `projetos/routes.ts`.
