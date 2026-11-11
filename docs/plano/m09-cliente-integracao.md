# m09 — Cliente: menu, ícone, datasets novos, seletor de modelo no firmware

Leia: `CONTRATOS-MODELOS.md` §4 "datasets", §7 e `client/src/lib/tipos-modelos.ts`.

## Arquivos (só estes)
- `client/src/ui/icones.tsx` (acrescentar o ícone `laboratorio` — frasco Erlenmeyer sólido no estilo dos outros — e o nome em `NomeIcone`; **faça isto primeiro** e avise "@m07 @m08 ícone laboratorio pronto")
- `client/src/layout/grupos.ts` (grupo "Modelos" depois de "Agentes")
- `client/src/layout/Layout.tsx` (só a correção do `end` em `/app/agentes`, §7)
- `client/src/modules/tinyml/Datasets.tsx`, `client/src/modules/tinyml/tinyml.css`
- `client/src/modules/firmware/EditorProjeto.tsx`, `client/src/modules/firmware/firmware.css`
- `client/src/modules/inicio/Painel.tsx` (só acrescentar o atalho rápido "Novo modelo" → `/app/modelos/novo`, ícone `laboratorio`)

## Passos
1. Ícone + grupos + Layout + atalho (itens acima).
2. `Datasets.tsx`: no Modal "Novo dataset", o tipo passa a incluir IMAGENS e CONVERSAS. Para eles o campo vira seletor de arquivo (`.zip` / `.jsonl`), com explicação do formato (IMAGENS: "um .zip com uma pasta por classe"; CONVERSAS: uma linha JSON `{"messages":[...]}` por conversa, mínimo 10) e envio por `fetch('/api/datasets/arquivo?nome=..&tipo=..&descricao=..', { method:'POST', headers:{Authorization:'Bearer '+token, 'Content-Type':'application/octet-stream'}, body: file })` com barra "Enviando…" e erro do servidor em `Aviso`. CSV continua igual. "Ver amostra" trata os 3 `formato`s: TABELA (como hoje), IMAGENS (por classe: nome, quantidade e miniaturas carregadas via `/api/datasets/:id/imagem?caminho=` com token → blob URL; revogar URLs ao fechar), CONVERSAS (balões user/assistant/system). Na tabela, coluna "Tipo" com rótulo amigável e "Amostras"; "Baixar" usa `/csv` para CSV e `/arquivo` para CONVERSAS (oculto para IMAGENS).
3. `EditorProjeto.tsx`: seletor "Embutir modelo" com `<optgroup>` "Agentes TinyML" (como hoje) e "Modelos treinados" (treinos SUCESSO de modelos TINYML/TABULAR, rótulo "<modelo> v<numero>" + " (publicado)" quando for o caso; publicado primeiro). O valor guarda o tipo (`a:<id>` / `t:<id>`) e o build envia `agenteId` ou `modeloTreinoId`.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build` sem erros nos seus arquivos.
