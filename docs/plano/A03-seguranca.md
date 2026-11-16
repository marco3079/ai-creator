# A03 — Segurança: segredos persistentes e troca de senha obrigatória

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §4.

## Arquivos (só estes)
- servidor: `server/src/lib/segredos.ts` (novo), `server/src/lib/config.ts`, `server/src/modules/auth/routes.ts`, `server/src/modules/usuarios/routes.ts`, `server/prisma/seed.ts`
- cliente: `client/src/lib/tipos.ts`, `client/src/lib/auth.tsx`, `client/src/layout/TrocarSenha.tsx` (novo), `client/src/layout/MenuUsuario.tsx`, `client/src/layout/login.css` (só acrescentar estilos se precisar)

A rota `/trocar-senha` e o redirecionamento ficam com o A08 (App.tsx). Não edite App.tsx.

## Passos
1. `segredos.ts` (§4). `config.ts`: `jwtSegredo` e `internoToken` passam a vir de `segredo(...)` (getter preguiçoso ou cálculo na importação — o `DATA_DIR` precisa existir: crie a pasta).
2. `auth/routes.ts`: incluir `trocarSenha` em `UsuarioPublico` (login e `/auth/eu`); `POST /auth/trocar-senha` com zod e bcrypt; registrar log `auth.trocar-senha`.
3. `usuarios/routes.ts`: criar usuário → `trocarSenha: true`; PUT com `senha` de outro usuário → `trocarSenha: true`.
4. `seed.ts`: admin novo com `trocarSenha: !process.env.ADMIN_SENHA`.
5. Cliente: tipo, `trocarSenha()` no contexto (grava novo token/usuário no localStorage), tela `TrocarSenha.tsx` com o visual do `Login.tsx` (senha atual, nova, confirmação, regras visíveis, erro em `Aviso`; ao concluir navega para `/app`); se o usuário só está trocando por vontade própria, mostrar "Voltar". Item "Trocar senha" no `MenuUsuario` → `/trocar-senha`.

## Verificação
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit`.
- Script temporário com `tsx` que importa `segredo()` com `DATA_DIR` temporário: 1ª chamada gera e grava, 2ª lê o mesmo valor, env válido tem prioridade. Publique.
