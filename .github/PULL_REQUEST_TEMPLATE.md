## O que mudou

<!-- Descreva as mudanças em poucas linhas. -->

## Por que

<!-- Motivo da mudança e issue relacionada, se houver (ex.: Closes #12). -->

## Como foi testado

<!-- Passos que você fez para verificar a mudança. -->

## Conferência

- [ ] `npx tsc --noEmit` sem erros em `server`
- [ ] `npx tsc --noEmit` e `npm run build` sem erros em `client`
- [ ] `npm run compile` (extensão) e `npm run build` (MCP), quando a mudança tocar neles
- [ ] `docker compose config -q` sem erros, quando a mudança tocar no Compose
- [ ] Testado no celular (obrigatório quando a mudança altera tela)
- [ ] Nenhuma senha, chave de API, token ou `.env` no diff
- [ ] Documentação atualizada (README, `docs/API.md`, `docs/ARQUITETURA.md` ou `CHANGELOG.md`, quando for o caso)
