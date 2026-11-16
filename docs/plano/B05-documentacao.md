# B05 — Documentação das levas A e B

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` (leva A, já implementada), `docs/plano/CONTRATOS-LEVA-B.md` (leva B, em implementação), e confira as rotas reais em `server/src/modules/**/routes.ts` (A está pronta; B pode mudar detalhes — siga o contrato).

## Arquivos (só estes)
`README.md`, `docs/FIRMWARE.md`, `docs/MODELOS.md`, `docs/ARQUITETURA.md`, `docs/API.md`, `docs/INTEGRACOES.md`, `docs/SUGESTOES.md`, `SECURITY.md`, `CHANGELOG.md`
(Não crie `TESTAR.md`: o main escreve.)

## Passos
1. `README.md`: atualizar Recursos (fila e vigia; eventos ao vivo; monitor serial; coleta de dados com simulador; testar modelo; uso e custos; agente com ferramentas; áudio/KWS; frota e OTA; segurança), o diagrama mermaid de serviços (mosquitto) e a tabela de serviços/portas (1883), e um link para `TESTAR.md` ("O que ainda precisa de teste com hardware ou chaves"). Mantenha o estilo e as capturas existentes.
2. `docs/FIRMWARE.md`: seções "Monitor serial", "Coletar dados pela serial" (formato `# AIC-COLETA ...`, modo simulador, como vira dataset), "Frota e OTA" (passo a passo: criar projeto modelo OTA, gerar chave, baixar `aic_config.h`, preencher Wi-Fi, gravar por USB a primeira vez, definir versão, atualizar; tópicos MQTT; firewall/porta 1883; segurança).
3. `docs/MODELOS.md`: "Áudio / palavra-chave" (dataset SONS, parâmetros, micro-frontend igual ao micro_speech, `features_audio.h`, exemplo de uso na placa) e "Testar antes de gravar" (aba Testar; latência é do servidor).
4. `docs/ARQUITETURA.md`: fila no Postgres, despachante, vigia (`/trabalhos`), SSE `/api/eventos`, MQTT/mosquitto, sequência OTA (mermaid).
5. `docs/API.md`: rotas novas (fila, eventos, prever, uso, auth/trocar-senha, frota/OTA/config.h).
6. `docs/INTEGRACOES.md`: agente com ferramentas da plataforma (como ligar, quais ferramentas, limites); release da extensão (tag `vscode-v*`, secret `VSCE_PAT`).
7. `SECURITY.md`: segredos persistentes em `/data/segredos.json`, troca de senha obrigatória, chave dos dispositivos (só hash no servidor), MQTT com usuário/senha (recomendação de TLS em produção), ferramentas do agente só no projeto vinculado.
8. `docs/SUGESTOES.md`: marcar como feitos os itens 1–3 e 5–16 das sugestões; manter próximos passos (MQTT com TLS e credencial por placa, AutoML, rastreamento de experimentos, avaliação de LLM ajustado, multi-tenant).
9. `CHANGELOG.md`: versão 0.3.0 com as levas A e B.

## Verificação
- Links internos existem (script curto que extrai `](…)` relativos e testa os arquivos); nenhum exemplo de código contradiz o código real (cite nomes de funções/rotas conferidos).
