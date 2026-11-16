# A08 — Cliente: carregamento sob demanda, rotas novas e menu

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §9, §4 (rota de troca de senha), §6 e §7 (rotas novas).

## Arquivos (só estes)
- `client/src/App.tsx`, `client/vite.config.ts`, `client/src/layout/grupos.ts`
- `client/src/modules/{agentes,firmware,inicio,modelos,sistema,tinyml}/index.tsx`

## Passos
1. Em cada `index.tsx`, troque os imports das telas por `lazy(() => import('./X').then((m) => ({ default: m.X })))`. Mantenha os imports de CSS. Não mude caminhos, rótulos, ordens nem perfis existentes.
2. Rotas novas (os componentes são de outros geradores; importe pelo nome do contrato):
   - firmware: `/app/serial` → `MonitorSerialPagina` (`./MonitorSerial`), rótulo "Monitor serial", ícone `terminal`, ordem 23, todos os perfis; `/app/coleta` → `Coleta` (`./Coleta`), rótulo "Coletar dados", ícone `upload`, ordem 31, ADMIN e DEV.
   - sistema: `/app/uso` → `Uso` (`./Uso`), rótulo "Uso e custos", ícone `grafico`, ordem 53, ADMIN e DEV.
3. `App.tsx`: `<Suspense fallback={<Carregando />}>` em volta do conteúdo das rotas (dentro do Layout, para a casca não piscar); rota `/trocar-senha` → `TrocarSenha` (do A03, `./layout/TrocarSenha`, também com lazy) fora do `LayoutDoPerfil`, exigindo login; se `usuario?.trocarSenha` e a rota atual não for `/trocar-senha`, `<Navigate to="/trocar-senha" replace />`.
4. `vite.config.ts`: `build.rollupOptions.output.manualChunks` com `vendor: ['react','react-dom','react-router-dom']`.
5. `grupos.ts`: `terminal` no grupo Firmware (depois de `chip`), `upload` no grupo Dados, `grafico` no grupo Sistema.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build` e publique a lista de chunks com tamanhos (o principal deve ficar < 250 KB). Componentes de outros geradores podem ainda não existir: publique a pendência, espere (BUS wait) e rode de novo.
