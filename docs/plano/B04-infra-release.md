# B04 — Mosquitto no Docker, instaladores, release da extensão e CI

Leia: `docs/plano/CONTRATOS-LEVA-B.md` §2 e §7, e os arquivos atuais `docker-compose.yml`, `.env.example`, `instalar.sh`, `instalar.ps1`, `.github/workflows/ci.yml`, `extensions/vscode/package.json`.

## Arquivos (só estes)
- `mosquitto/mosquitto.conf`, `mosquitto/entrypoint.sh` (novos)
- `docker-compose.yml`, `.env.example`, `instalar.sh`, `instalar.ps1`, `.gitattributes` (só se precisar garantir LF no `entrypoint.sh`)
- `.github/workflows/release-vscode.yml` (novo), `.github/workflows/ci.yml` (job `docker` também valida o compose com o mosquitto; nada mais)
- `extensions/vscode/package.json` (versão 0.2.0), `extensions/vscode/CHANGELOG.md`

## Passos
1. `mosquitto.conf`: `listener 1883`, `allow_anonymous false`, `password_file /mosquitto/config/senhas`, persistência em `/mosquitto/data`, log em stdout. `entrypoint.sh`: falha com mensagem clara se `MQTT_USUARIO`/`MQTT_SENHA` vazios; cria `/mosquitto/config/senhas` com `mosquitto_passwd -b -c` e executa `mosquitto -c ...`. LF obrigatório.
2. `docker-compose.yml`: serviço `mosquitto` (`eclipse-mosquitto:2.0.20`, monta `./mosquitto/mosquitto.conf` e `entrypoint.sh` somente leitura, volume `mosquitto:/mosquitto/data`, `entrypoint: ["sh", "/aic/entrypoint.sh"]`, porta `${MQTT_PORTA:-1883}:1883`, healthcheck simples com `mosquitto_sub -t '$$SYS/#' -C 1 -u ... -P ... -W 3`); server com `MQTT_URL: mqtt://mosquitto:1883`, `MQTT_USUARIO`, `MQTT_SENHA` (padrão `aic` / `troque-senha-mqtt`), `MQTT_HOST_PUBLICO`, `MQTT_PORTA`, `SERVIDOR_URL_PUBLICA`; `depends_on` do server **não** deve exigir o mosquitto saudável (o server funciona sem broker).
3. `.env.example` com as variáveis novas comentadas; `instalar.sh`/`.ps1` geram `MQTT_SENHA` aleatória e perguntam (opcional, com Enter para pular) o IP da máquina na rede para `MQTT_HOST_PUBLICO` e `SERVIDOR_URL_PUBLICA=http://<ip>:<WEB_PORT>`.
4. `release-vscode.yml`: gatilhos `push: tags: ['vscode-v*']` e `workflow_dispatch`; job `build` (node 20, `npm ci`, `npm run compile`, `npx vsce package --no-dependencies`, upload do `.vsix` como artifact); job `release` (precisa de `contents: write`; usa `softprops/action-gh-release@v2` com o `.vsix`, só em tag); job `marketplace` que roda só se `secrets.VSCE_PAT != ''` (via `env` + `if`), `npx vsce publish -p "$VSCE_PAT" --no-dependencies`.
5. `extensions/vscode/package.json` 0.2.0 e CHANGELOG.

## Verificação
- `docker compose config -q` (com e sem perfis); `bash -n instalar.sh` e `bash -n mosquitto/entrypoint.sh`; YAML dos workflows válido (pyyaml num venv).
- Suba só o mosquitto num projeto separado para testar: `MQTT_USUARIO=aic MQTT_SENHA=teste docker compose -p mqtt-teste up -d mosquitto` (troque a porta com `MQTT_PORTA=18831`), confirme com `docker run --rm --network host eclipse-mosquitto:2.0.20 mosquitto_pub -h localhost -p 18831 -u aic -P teste -t x -m y` (deve funcionar) e com senha errada (deve falhar). Depois `docker compose -p mqtt-teste down -v`. Não mexa no stack principal.
