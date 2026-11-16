# B01 — Servidor: frota, MQTT e OTA

Leia: `docs/plano/CONTRATOS-LEVA-B.md` §1–§4 (sua especificação), `client/src/lib/tipos-frota.ts`, o schema (`Dispositivo`, `TelemetriaDispositivo`, `Build.artefatoOta`) e o código atual de `server/src/modules/dispositivos/routes.ts`, `server/src/lib/eventos.ts`, `server/src/modules/builds/routes.ts`.

## Arquivos (só estes)
- novos: `server/src/modules/frota/{mqtt.ts, dispositivo.ts, routes.ts, config.ts, comum.ts}`
- editar: `server/src/modules/dispositivos/routes.ts` (formato `DispositivoFrota`, `projetoId`, rotas novas do §4), `server/src/lib/eventos.ts` (tipo `'dispositivo'` e campos `online`/`statusOta`), `server/src/modules/builds/routes.ts` (callback aceita e grava `artefatoOta`), `server/src/lib/config.ts` (só acrescentar `mqttUrl`, `mqttUsuario`, `mqttSenha`, `mqttHostPublico`, `mqttPorta`, `servidorUrlPublica`), `server/package.json` + `package-lock.json` (`mqtt@5.10.3`)

## Passos
1. `config.ts` e dependência (`npm install mqtt@5.10.3` em `server/`).
2. `frota/comum.ts`: `gerarChaveDispositivo()` (`aicd_` + 40 hex), `hashChave`, `paraDispositivoFrota(d)`, `autenticarDispositivo(req)` (cabeçalhos; 401 sem/errados; limite 30 req/min por id em memória).
3. `frota/mqtt.ts`: `iniciarMqtt()` idempotente (sem `MQTT_URL` → não conecta), assina `aic/d/+/telemetria` e `aic/d/+/status`, valida a chave da telemetria pelo hash (cache em memória com invalidação ao gerar chave nova), atualiza o dispositivo e grava amostras (≤ 1 a cada 30 s), emite evento; `publicarComando(id, acao): boolean`; vigia de 60 s para `online=false`; limpeza diária > 7 dias. Erros só logam.
4. `frota/dispositivo.ts`: rotas `/ota/*` (§3), sem `autenticar` de usuário, com `autenticarDispositivo`. O binário sai com `res.sendFile` e cabeçalho `x-MD5` (md5 do arquivo, calculado e guardado em memória por buildId).
5. `frota/config.ts`: gera o `aic_config.h` (§4), com valores escapados para string C.
6. `frota/routes.ts`: chama `iniciarMqtt()` no topo; registra o roteador de `dispositivo.ts`; `GET /dispositivos/:id/config.h` (autenticar; confere `?chave` contra o hash).
7. `dispositivos/routes.ts`: formato `DispositivoFrota` com o projeto (`select id, nome`), rotas `chave`, `alvo`, `comando`, `telemetria` (§4). A chave em claro só na resposta de `POST /chave`.
8. `builds/routes.ts`: zod do callback com `artefatoOta?: string` e gravação.

## Verificação
- `cd server && npx tsc --noEmit`.
- Teste com `tsx` + um broker de verdade em container temporário: `docker run -d --name mqtt-teste -p 18830:1883 eclipse-mosquitto:2.0.20 mosquitto -c /mosquitto-no-auth.conf`; publique telemetria com chave certa e errada usando a lib `mqtt` e mostre o que o handler aceitaria (isole a função de validação para testar sem banco). Remova o container no fim.
