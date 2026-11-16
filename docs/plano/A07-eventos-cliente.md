# A07 — Cliente: eventos ao vivo no lugar do polling + encaixes

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §2, `client/src/lib/tipos-melhorias.ts` (`EventoTrabalho`) e `client/src/lib/sse.ts` (como o projeto já lê streams com token).

## Arquivos (só estes)
- `client/src/lib/eventos.ts` (novo)
- `client/src/modules/tinyml/componentes.tsx` (AbaTreino)
- `client/src/modules/modelos/Detalhe.tsx` (eventos + nova aba "Testar")
- `client/src/modules/modelos/DetalheTreino.tsx`
- `client/src/modules/firmware/EditorProjeto.tsx` (eventos + seção "Monitor serial")
- `client/src/layout/Notificacoes.tsx`

## Passos
1. `eventos.ts` (§2): singleton com contagem de assinantes; conecta em `GET /api/eventos` com `Authorization` do `localStorage` (`aicreator.token`); parse de linhas `data:`; ignora `:` (ping); reconexão com espera crescente; para quando não há assinantes; 401 → não reconecta. `useEventosTrabalho(filtro, aoEvento)` usa `useRef` para não reassinar a cada render.
2. Troque os `setTimeout` de 2–3 s por: recarregar quando chegar evento do mesmo tipo/id (`treino` + `agenteId` na AbaTreino; `treinoModelo` + `modeloId` no Detalhe/DetalheTreino; `build` + `projetoId` no EditorProjeto) e um polling de segurança de 20 s só enquanto houver trabalho em FILA/EXECUTANDO. Mostrar "na fila (n)" quando o status for FILA.
3. `Detalhe.tsx`: aba `{ id:'testar', rotulo:'Testar' }` entre "Comparar" e "Configuração", renderizando `<AbaTestar modelo={modelo} treinos={modelo.treinos} />` (do A06, `./AbaTestar`) só para TINYML/TABULAR (esconda a aba para LLM).
4. `EditorProjeto.tsx`: abaixo do gravador, seção recolhível "Monitor serial" com `<MonitorSerial compacto />` (do A05, `./MonitorSerial`).
5. `Notificacoes.tsx`: recarregar o painel ao receber qualquer evento (com debounce de 1 s), mantendo o intervalo de 60 s.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build` (quando `AbaTestar.tsx` e `MonitorSerial.tsx` existirem; até lá publique a pendência e espere com BUS wait).
