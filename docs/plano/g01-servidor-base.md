# g01 — Base do servidor

Leia antes: `docs/plano/CONTRATOS.md` (§1, §2, §3 "Bibliotecas comuns" e "auth / usuarios / tokens / plataforma / logs / painel").
Referência: `REF/server/` (mesma stack). Adapte, não copie módulos escolares.

## Arquivos que você pode criar/editar (só estes)
- `server/package.json`, `server/tsconfig.json`, `server/Dockerfile`, `server/.dockerignore`, `server/.env.example`
- `server/src/server.ts`, `server/src/app.ts`
- `server/src/lib/{prisma,config,erros,auth,log,slug,arquivos}.ts`
- `server/src/modules/{auth,usuarios,tokens,plataforma,logs,painel}/routes.ts`
- `server/prisma/seed.ts`
NÃO edite `server/prisma/schema.prisma` nem nada em `server/src/modules/llm/`.

## Passos
1. `package.json`: copie o do REF e ajuste `name: "ai-creator-server"`. Dependências a mais: `"@anthropic-ai/sdk": "1.8.0"`. Mantenha versões exatas do REF para o resto (express 4.22.3, prisma/@prisma/client 5.22.0, zod 4.6.7, tsx, typescript 5.6.3, bcryptjs, jsonwebtoken, cors e @types). Remova nodemailer. Scripts: `dev`, `start`, `typecheck`, `seed`, `db:push`, `postinstall: prisma generate`.
2. `tsconfig.json` igual ao REF (strict). Garanta `"moduleResolution"` compatível com `tsx` e com `import Anthropic from '@anthropic-ai/sdk'` (esModuleInterop true).
3. `lib/config.ts` conforme a tabela de variáveis do CONTRATOS §1 (dev: se `DATA_DIR` ausente usa `path.resolve('dados')`).
4. `lib/prisma.ts`, `lib/erros.ts`, `lib/log.ts`, `lib/slug.ts` (remover acentos com `normalize('NFD')`), `lib/arquivos.ts` exatamente com as assinaturas do contrato.
5. `lib/auth.ts`: JWT (jsonwebtoken, 12h, payload `{id}`; recarrega o usuário do banco e recusa `ativo=false`). Token de API: se o Bearer começa com `aic_`, calcule `sha256` hex, procure `TokenApi` não revogado, atualize `ultimoUso` e use o usuário dono. `exigirPerfil`, `exigirInterno`, `assinarJwt`, augment de `Express.Request`.
6. `app.ts`: `cors()`, `express.json({limit:'25mb'})`, rotas públicas são tratadas dentro dos próprios módulos (aplique `autenticar` por rota, não globalmente — `/auth/login`, `/plataforma` GET, `/saude` e `/interno/*` não usam JWT). Carregamento automático: `fs.readdirSync(path.join(<dir de app.ts>,'modules'))`, para cada pasta com `routes.ts` faça `const m = await import(pathToFileURL(arquivo).href); app.use('/api', m.default)`. Exporte `async function criarApp(): Promise<Express>`. Tratador de erros conforme contrato. 404 JSON `{erro:'Rota não encontrada'}` para `/api/*`.
7. `server.ts`: `criarApp()` e `listen(config.porta)` com log.
8. Módulos de rota (contrato §3, g01): auth, usuarios, tokens (gera `aic_` + 40 hex com `crypto.randomBytes(20)`, `prefixo` = 12 primeiros caracteres), plataforma (upsert id=1), logs, painel (`/saude` fica em `plataforma/routes.ts`). Valide corpos com zod. Registre logs (`registrar`) em login, criação/edição/remoção.
9. `prisma/seed.ts` idempotente (upsert): admin (ADMIN_EMAIL/ADMIN_SENHA, nome "Administrador"), plataforma id=1, e dados de demonstração **só se não houver agentes**: 
   - Agente LLM "Assistente de Firmware" (ANTHROPIC, `claude-opus-5-5`, esforço `high`, prompt de sistema de ~10 linhas sobre ajudar com C++/PlatformIO/ESP32, ferramentas `["Read","Edit","Bash"]`, tags `["firmware","esp32"]`).
   - Agente LLM "Revisor de Código" (ANTHROPIC, `claude-sonnet-5-5`, esforço `medium`).
   - Agente LLM "Assistente Local" (OLLAMA, `llama3.2`, temperatura 0.7).
   - Projeto "Blink ESP32" (slug `blink-esp32`, placa ESP32) com `platformio.ini` (`[env:principal]`, platform espressif32, board esp32dev, framework arduino, monitor_speed 115200) e `src/main.cpp` (pisca LED no GPIO 2 e imprime no Serial).
   - Agente TinyML "Detector de Gestos" (configTinyml = CONFIG_TINYML_PADRAO com classes `["parado","acenar","circulo"]`, projetoId do Blink).
   - Cada agente com VersaoAgente 1 (nota "Criação").
10. `Dockerfile` como o do REF (node:20-slim + openssl), `EXPOSE 3333`, CMD `npx prisma db push --skip-generate && npx tsx prisma/seed.ts && npx tsx src/server.ts`. `.dockerignore`: node_modules, dados, .env. `.env.example` com todas as variáveis do contrato.

## Aceite / verificação
- `cd server && npm install && npx prisma generate && npx tsc --noEmit` sem erros (os módulos de outros geradores podem ainda não existir — o carregamento é dinâmico, então não quebra o build).
- `grep -r "escola" server/src` vazio.
