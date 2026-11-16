# A04 — Testes de API, E2E com Playwright e CI

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §5 e o fluxo das rotas em `docs/plano/CONTRATOS.md` §3 e `CONTRATOS-MODELOS.md` §4. Outros geradores mudam rotas em paralelo (fila, troca de senha): escreva os testes pelo contrato e rode no fim.

## Arquivos (só estes)
- `server/package.json` (devDependencies e script `test`), `server/vitest.config.ts`, `server/test/**` (`ajuda.ts` com login e criação de usuário de teste; `auth.test.ts`, `agentes.test.ts`, `datasets.test.ts`, `modelos.test.ts`, `projetos.test.ts`, `tokens.test.ts`)
- `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tests/*.spec.ts`, `e2e/README.md`
- `.github/workflows/ci.yml`

## Passos
1. Servidor (§5): os testes importam `criarApp()` de `src/app.ts` e usam `supertest`. Cubra: login ok/401; rota sem token 401; LEITOR recebe 403 ao escrever; token `aic_` autentica; agentes (criar, PUT gera versão 2, exportar md, importar); dataset CSV (criar, amostra com `formato:'TABELA'`, CSV inválido → 400 com nº da linha); modelos (criar TABULAR, `GET /modelos/opcoes`, treinar → linha em `FILA` — o despachante fica desligado por `FILA_DESLIGADA=1`); projetos (criar com `modelo:'COLETOR'` gera `src/main.cpp` com `AIC-COLETA`, build com `modeloTreinoId` inválido → 400); troca de senha (`POST /auth/trocar-senha`). Banco limpo por arquivo de teste (`prisma db push --force-reset` no script, e `deleteMany` em `beforeEach` onde precisar).
2. E2E (`e2e/`): `login.spec.ts` (entra e vê "Olá"), `agentes.spec.ts` (cria agente LLM e vê na lista), `projetos.spec.ts` (cria projeto e abre o editor com `main.cpp`), `modelos.spec.ts` (assistente: escolhe TinyML e avança), `senha.spec.ts` (cria usuário pela API com senha temporária, entra e é levado a `/trocar-senha`). Use `getByRole`/`getByText` em português.
3. CI: job `server-testes` (service `postgres:16-alpine`, `DATABASE_URL`, `npm ci` ou `npm install`, `npx prisma generate`, `npm test`); job `e2e` (`docker compose up -d --build db server client` com `ADMIN_SENHA=senha-e2e-123` e `JWT_SECRET`/`INTERNO_TOKEN` de teste, espera `/api/saude`, `npx playwright install --with-deps chromium`, `npx playwright test`; publique o relatório como artifact em falha). Mantenha os jobs existentes.

## Verificação
- Servidor: rode os testes contra um Postgres local temporário: `docker run -d --name pg-teste -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:16-alpine`, `DATABASE_URL=postgresql://postgres:x@localhost:55432/postgres npm test`, e no fim `docker rm -f pg-teste`. Publique o resultado.
- E2E: rode contra o stack em http://localhost:8080 só quando os outros geradores tiverem entregue (pergunte `@main` antes de rodar). Não faça `docker compose down`.
