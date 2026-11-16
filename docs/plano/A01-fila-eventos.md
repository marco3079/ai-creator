# A01 — Servidor: fila no Postgres, vigia e eventos ao vivo

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §1 e §2 (sua especificação), e o código atual de `server/src/modules/{treinos,projetos,builds,treinos-modelo}`. O schema já tem `tentativas`, `atualizadoEm` e `Build.iniciadoEm` (rode `npx prisma generate` em `server/`).

## Arquivos (só estes)
- novos: `server/src/lib/eventos.ts`, `server/src/modules/fila/{routes,despachante,vigia,servicos}.ts`, `server/src/modules/projetos/build.ts`
- editar: `server/src/modules/treinos/routes.ts`, `server/src/modules/projetos/routes.ts` (rota de build → `criarBuild`; `POST /projetos` aceita `modelo`), `server/src/modules/builds/routes.ts` (callback: emitir evento), `server/src/modules/treinos-modelo/{routes,despachar}.ts`, `server/src/modules/treinos-modelo/openai.ts` (**só** acrescentar `emitirEvento` onde grava status/log)

## Passos
1. `lib/eventos.ts` (§2).
2. `fila/servicos.ts`: tabela dos serviços (nome, url de `config`, capacidade por env) e `async function trabalhosAtivos(nome)` (GET `/trabalhos`, timeout 3 s, `null` se offline).
3. `projetos/build.ts`: extraia da rota atual a validação + escrita em disco + criação da linha (agora FILA) → `criarBuild`; e o pedido HTTP ao builder → `enviarBuild` (resultado `'ok' | 'indisponivel' | {erro}`). Rota `POST /projetos/:id/build` passa a ser só validação do corpo + `criarBuild` + `res.status(202).json(build)`.
4. `treinos/routes.ts`: `POST /agentes/:id/treinar` cria FILA + `acordarFila()` + evento; exporte `enviarTreinoAgente(id)` (mesmo resultado tri-estado); callback interno passa a usar `updateMany` com `status: { not: 'CANCELADO' }` e emite evento.
5. `treinos-modelo/despachar.ts`: `despacharTreino(id)` vira `enviarTreinoModelo(id): Promise<'ok'|'indisponivel'|{erro}>` sem mudar status sozinho (o despachante decide); LLM_NUVEM sem chave → `{erro: MSG_OPENAI}`; mantenha `marcarFalha` exportado. `treinos-modelo/routes.ts`: `POST /modelos/:id/treinar` só cria FILA + `acordarFila()`; callback e cancelar emitem evento.
6. `fila/despachante.ts` e `fila/vigia.ts` conforme §1 (use `updateMany` com o status esperado no `where`; logs em português; emitir evento em cada transição). Um erro num item não pode derrubar o ciclo.
7. `fila/routes.ts`: inicia fila e vigia no topo; `GET /fila`; `GET /eventos` (SSE).
8. `projetos/routes.ts` `POST /projetos`: `modelo` opcional (zod enum `BLINK|COLETOR|OTA`, padrão BLINK) passado a `arquivosModelo(placa, nome, modelo)` (a assinatura nova é do A05; se ainda não existir, passe e deixe o typecheck para quando ele entregar).

## Verificação
- `cd server && npx tsc --noEmit`.
- Script temporário (scratchpad) com `tsx` que importa `lib/eventos.ts`, assina e emite 2 eventos (prova do bus). O teste com banco fica para o main no Docker; descreva no `done` como testou cada transição por leitura.
