# B03 — Cliente: tela Frota e detalhe do dispositivo

Leia: `docs/plano/CONTRATOS-LEVA-B.md` §4 e §6, `client/src/lib/tipos-frota.ts`, `client/src/lib/tipos-melhorias.ts` (`EventoTrabalho` com `tipo:'dispositivo'`), `client/src/lib/eventos.ts` (`useEventosTrabalho`) e o código atual de `client/src/modules/firmware/Dispositivos.tsx` e `index.tsx`.

## Arquivos (só estes)
- `client/src/modules/firmware/Dispositivos.tsx`, `client/src/modules/firmware/DetalheDispositivo.tsx` (novo), `client/src/modules/firmware/frota.css` (novo), `client/src/modules/firmware/index.tsx` (só acrescentar a rota `/app/dispositivos/:id`, lazy, menu false, todos os perfis; e trocar o rótulo do menu de "Dispositivos" para "Frota")

## Passos
1. `Dispositivos.tsx` (§6): mantenha o CRUD atual (nome, placa, porta, notas) e acrescente `projetoId` (Selecao de projetos) no Modal; cartões com bolinha verde/cinza, "visto há X", RSSI com ícone de barras, versão atual × alvo ("#12 → #15"), status da OTA; filtro Todos/Online/Offline; ações do §6. "Gerar chave": confirma (invalida a anterior), mostra a chave uma vez com Copiar e botão "Baixar aic_config.h" (fetch com Bearer em `/api/dispositivos/:id/config.h?chave=...` → download do arquivo). "Definir versão": Modal com builds SUCESSO (`GET /builds?projetoId=`) filtrados pela placa e com `artefatoOta`; opção "Nenhuma". "Atualizar agora"/"Reiniciar": `POST /comando`, erro 503 → Aviso "Broker MQTT indisponível". Botões de escrita só para ADMIN/DEV.
2. `DetalheDispositivo.tsx` (§6): dados do dispositivo, dois gráficos (RSSI dBm e heap livre em KB) das últimas 24 h, tabela da última telemetria (todas as chaves), card OTA, e o guia passo a passo (texto + link para criar projeto com modelo OTA em `/app/projetos`).
3. Ao vivo: `useEventosTrabalho((e) => e.tipo === 'dispositivo', recarregar)` com debounce de 1 s; polling de segurança de 30 s.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build`.
