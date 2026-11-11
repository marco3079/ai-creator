# g02 — Base do cliente

Leia antes: `docs/plano/CONTRATOS.md` (§4 inteiro). Referência: `REF/client/` — o layout tem que ficar **igual** (mesmas classes CSS, mesmas cores, claro/escuro, celular com barra inferior e gaveta).

## Arquivos que você pode criar/editar (só estes)
- `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/Dockerfile`, `client/.dockerignore`, `client/nginx.conf`, `client/src/vite-env.d.ts`
- `client/public/*` (logo, manifest, sw.js, ilustrações)
- `client/src/main.tsx`, `client/src/App.tsx`
- `client/src/lib/{api,auth,plataforma,rotas,tema,tipos,useDados,sse,tipos-api}.ts(x)`
- `client/src/layout/*` (Layout, Busca, MenuUsuario, Notificacoes, Login, GraficoLinha, Painel opcional, grupos.ts e CSS)
- `client/src/ui/{index.tsx,icones.tsx,estilo.css,MenuAcoes.tsx}`
- `client/src/modules/inicio/{index.tsx,painel.css}` (e outros arquivos dentro de `modules/inicio/`)

## Passos
1. Copie do REF: `package.json` (name `ai-creator-client`, mesmas versões, **mais** a dependência `"esptool-js": "0.7.1"` usada pelo g08), `tsconfig.json`, `index.html` (title "AI Creator"), `vite.config.ts` (proxy `/api` → `http://localhost:3333`), `src/vite-env.d.ts`, `Dockerfile`.
2. `nginx.conf`: igual ao REF, mas `proxy_pass http://server:3333;`, `client_max_body_size 30m;` e, no `location /api/`, acrescente para SSE: `proxy_http_version 1.1; proxy_set_header Connection ""; proxy_buffering off; proxy_cache off; proxy_read_timeout 600s;`.
3. `public/`: crie `logo.svg` (símbolo: chip estilizado com um "cérebro"/rede neural, azul `#2563eb` sobre quadrado arredondado, 64×64) e `logo-simbolo.png` NÃO é necessário — use o SVG onde o REF usa PNG. Ilustrações: o REF usa PNGs de prédio/livros/capelo; substitua por SVGs próprios simples (`ilustracoes/placa-claro.svg`, `placa-escuro.svg` — placa de circuito isométrica; `ilustracoes/robo.svg` — robozinho para o cartão da barra lateral). Ajuste os CSS que apontam para os PNGs. `manifest.webmanifest` e `sw.js` adaptados (nome AI Creator).
4. `lib/`: copie `api.ts`, `useDados.ts`, `tema.ts`, `rotas.ts` trocando chaves `escola.` → `aicreator.`. `tipos.ts`: `Perfil`, `UsuarioLogado` do contrato (sem aluno/professor/TI/foto). `auth.tsx`: versão enxuta (entrar, sair, sem busca de foto). `plataforma.tsx`: lê `GET /api/plataforma` (nome, slogan, corPrimaria) e expõe `{ plataforma, logoSrc: '/logo.svg' }`; aplica `corPrimaria` numa variável CSS se o REF fizer isso. `sse.ts` e `tipos-api.ts` conforme contrato §4 (tipos fiéis ao §2/§3).
5. `ui/`: copie `index.tsx`, `icones.tsx`, `estilo.css` do REF; mova `MenuAcoes` (de `REF/client/src/modules/cadastros/MenuAcoes.tsx`) para `ui/MenuAcoes.tsx` e reexporte. Acrescente os ícones novos do contrato (SVG 24×24 no mesmo estilo sólido dos existentes).
6. `layout/`: copie `Layout.tsx`, `casca.css`, `Busca.tsx`, `MenuUsuario.tsx`, `Login.tsx`, `login.css`, `GraficoLinha.tsx`, `Notificacoes.tsx`. Remova chat, suporte, novidades, esqueci/redefinir senha. `caminhoDoPerfil` → `'/app'`, `nomePortal` conforme contrato. `Notificacoes`: mostra as 6 atividades recentes de `GET /api/painel` (`recentes`), contador = quantos estão EXECUTANDO/FALHA. `grupos.ts` com os grupos do contrato. Login: textos "AI Creator — agentes de IA, TinyML e firmware", ilustração nova.
7. `App.tsx`: igual ao REF (glob de módulos, `LayoutDoPerfil`, `RotaProtegida`, 404) sem esqueci-senha e sem `RegistroDeTelas`. Raiz `/` → `/app` ou `/login`.
8. `modules/inicio/`: rota `/app` (contrato), adaptando `REF/client/src/layout/Painel.tsx` + `painel.css`:
   - Saudação "Olá, <primeiro nome>!" / "Aqui está o resumo da sua plataforma de IA." + data/hora.
   - 4 cartões KPI: Agentes LLM (robo), Agentes TinyML (cerebro), Projetos (pasta), Dispositivos (chip).
   - Gráfico de linha "Compilações (14 dias)" com `buildsPorDia` (sucesso).
   - "Atividade recente" (lista `recentes` com `Selo` de status, link para `/app/builds` ou `/app/agentes/:agenteId` quando TREINO — use `/app/tinyml` se não houver id do agente).
   - Cartão "Agente em destaque" (`destaque`) com botão "Abrir" → `/app/agentes/:id`.
   - "Atalhos rápidos": Novo agente LLM (`/app/agentes/novo?tipo=LLM`), Novo agente TinyML (`?tipo=TINYML`), Novo projeto (`/app/projetos`), Datasets, Compilações, Dispositivos, Integrações, Tokens.

## Aceite / verificação
- `cd client && npm install && npx tsc --noEmit && npx vite build` sem erros (os outros módulos ainda podem não existir; o glob não quebra).
- `grep -ri "escola\|aluno\|professor" client/src` vazio.
