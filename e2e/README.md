# Testes E2E (Playwright)

Testes de ponta a ponta do AI Creator. Rodam no navegador (Chromium) contra o stack do `docker-compose.yml` já de pé.

## Como rodar

1. Suba o stack com um administrador de teste conhecido (sem troca de senha forçada):

   ```bash
   ADMIN_SENHA=senha-e2e-123 docker compose up -d --build db server client
   ```

   Espere o servidor responder em `http://localhost:8080/api/saude`.

2. Instale as dependências e o navegador (uma vez):

   ```bash
   cd e2e
   npm install
   npx playwright install --with-deps chromium
   ```

3. Rode os testes:

   ```bash
   npm test
   ```

   Relatório HTML: `npm run test:relatorio` (pasta `playwright-report/`).

## Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8080` | Endereço do cliente web |
| `E2E_EMAIL` | `admin@aicreator.local` | E-mail do administrador do stack |
| `E2E_SENHA` | `senha-e2e-123` | Senha do administrador (igual à `ADMIN_SENHA` do stack) |

## Testes

- `tests/login.spec.ts`: entra com o administrador e vê a saudação.
- `tests/agentes.spec.ts`: cria um agente LLM e ele aparece na lista.
- `tests/projetos.spec.ts`: cria um projeto de firmware e abre o editor com `main.cpp`.
- `tests/modelos.spec.ts`: assistente de novo modelo, escolhe TinyML e avança.
- `tests/senha.spec.ts`: cria usuário pela API com senha temporária, entra e é levado a `/trocar-senha`.

Os testes rodam em sequência (um worker) porque compartilham o mesmo banco. Os nomes criados incluem um carimbo de tempo, então rodar de novo não colide.

## Não rode contra produção

Os testes criam usuários, agentes, projetos e modelos. Use apenas um stack de teste.

## Relatório no CI

No workflow `.github/workflows/ci.yml`, o job `e2e` envia `e2e/playwright-report` como artifact quando algum teste falha.
