# B06 — Histórico (versões) dos projetos de firmware

Item 16 das sugestões. O schema já tem `VersaoProjeto` (do main, somente leitura). Leia `server/src/modules/projetos/routes.ts`, `server/src/lib/eventos.ts` (`ouvirEventos`), `client/src/modules/firmware/EditorProjeto.tsx` e `docs/plano/CONTRATOS.md` §3 (projetos).

## Conceito
Cada versão é uma foto de **todos** os arquivos do projeto, como um commit: número sequencial, mensagem, autor, data. Criada (a) manualmente ("Salvar versão" com mensagem) e (b) automaticamente quando um build é criado (mensagem "Compilação #<id>", `buildId`), sem repetir se o conteúdo for idêntico à última versão (`hash` = sha256 dos arquivos ordenados por caminho). Dá para ver o diff de uma versão contra a atual ou contra a anterior, restaurar uma versão (cria antes uma versão automática "Antes de restaurar a v<n>") e exportar o projeto como repositório Git (`.zip` com a pasta `.git`, um commit por versão).

## Arquivos (só estes)
- servidor: `server/src/modules/versoes-projeto/{routes.ts, comum.ts, git.ts}` (novos), `server/package.json` + lock (`isomorphic-git@1.27.2`, `adm-zip` já existe)
- cliente: `client/src/modules/firmware/{HistoricoProjeto.tsx, diff.ts, historico.css}` (novos), `client/src/modules/firmware/EditorProjeto.tsx` (só acrescentar o botão "Histórico" no cabeçalho, que abre `<HistoricoProjeto projetoId=... aoRestaurar={recarregar} />` num painel lateral/Modal)
NÃO edite `projetos/routes.ts`, `projetos/build.ts`, `builds/routes.ts` (outros geradores estão neles).

## API (autenticar; escrita ADMIN/DEV)
- `GET /projetos/:id/versoes` → `{ numero, mensagem, autor: {id,nome}|null, buildId, criadoEm, totalArquivos }[]` (mais recente primeiro).
- `POST /projetos/:id/versoes` `{ mensagem }` (1..200) → versão criada, ou 409 "Nada mudou desde a v<n>".
- `GET /projetos/:id/versoes/:numero` → versão com `arquivos`.
- `POST /projetos/:id/versoes/:numero/restaurar` → substitui os `ArquivoProjeto` pelos da versão (apaga os que não existiam) numa transação; antes cria a versão automática.
- `GET /projetos/:id/git.zip` → `.zip` do repositório Git (isomorphic-git com `fs` em pasta temporária: `git.init`, para cada versão em ordem escreve os arquivos, `git.add` de tudo/remove os apagados, `git.commit` com a mensagem, autor = nome do usuário ou "AI Creator" e e-mail `aic@local`, data = `criadoEm`); apaga a pasta temporária no fim.
- Versão automática no build: no topo de `routes.ts`, assine `ouvirEventos` e, para `tipo:'build'` com `status:'FILA'` (criação), crie a versão do `projetoId` do evento (ignorar erros; nunca derrubar o servidor).

## Cliente
- `diff.ts`: diff por linhas (algoritmo LCS/Myers simples, sem dependência) → blocos `{tipo:'igual'|'mais'|'menos', linhas}` com contexto de 3 linhas e colapso do resto.
- `HistoricoProjeto.tsx`: lista de versões (mensagem, autor, data relativa, selo "build #id"), campo "Salvar versão" com mensagem; ao escolher uma versão: lista de arquivos alterados (adicionado/removido/modificado) e diff do arquivo escolhido (verde/vermelho, claro/escuro), contra "versão anterior" ou "arquivos atuais"; botões "Restaurar esta versão" (confirmação) e "Baixar repositório Git" (fetch com Bearer → download `<slug>-git.zip`). LEITOR só visualiza.

## Verificação
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit && npx vite build`.
- Teste com `tsx` de `comum.ts` (hash estável independente da ordem) e de `git.ts` gerando um repositório com 3 versões numa pasta temporária; confira com `git log --oneline` no repositório gerado (o git existe no Git Bash). Teste do `diff.ts` com 3 casos.
