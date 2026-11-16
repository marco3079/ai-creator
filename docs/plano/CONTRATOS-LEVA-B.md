# Contratos — leva B (OTA e frota, release da extensão, documentação)

Continuam valendo `CONTRATOS.md`, `CONTRATOS-MODELOS.md` e `CONTRATOS-MELHORIAS.md` (fila: builds só entram em `FILA` via `criarBuild` e o despachante envia; eventos com `emitirEvento`).
Do main, **somente leitura**: `server/prisma/schema.prisma` (campos novos em `Dispositivo`, modelo `TelemetriaDispositivo`, `Build.artefatoOta`), `client/src/lib/tipos-frota.ts`.

## 1. Visão geral
Placas ESP32/ESP32-S3 com o firmware **OTA** (modelo de projeto `OTA`) entram na frota:
- Conectam no Wi-Fi e no broker **MQTT** (serviço `mosquitto` no Docker, porta 1883 publicada no host para as placas da rede local).
- Publicam telemetria a cada 10 s e o status (online/offline por *Last Will*).
- Recebem o comando `atualizar` e, também a cada 1 h, consultam o servidor por HTTP; se houver build alvo diferente do atual, baixam o binário da aplicação e atualizam com `HTTPUpdate`.
- A identidade da placa é o **id do dispositivo** + **chave** `aicd_<40 hex>` (o servidor guarda só o sha256).

## 2. MQTT (B01 servidor, B04 infraestrutura)
- Broker: `eclipse-mosquitto:2.0.20`, `allow_anonymous false`, um usuário/senha (`MQTT_USUARIO`/`MQTT_SENHA` do `.env`; o `instalar.*` gera a senha). O arquivo de senhas é gerado na subida do container (script de entrada do mosquitto com `mosquitto_passwd -b -c`). Porta `${MQTT_PORTA:-1883}:1883`.
- Tópicos (prefixo `aic/d/<dispositivoId>/`):
  - `telemetria` (placa → servidor): JSON `TelemetriaPlaca` (`tipos-frota.ts`) + `"chave": "<chave>"` (o servidor valida a chave e **descarta** mensagens com chave errada; a chave não é salva na telemetria).
  - `status` (placa → servidor, retido): `"online"` / `"offline"` (o LWT publica `offline`).
  - `comando` (servidor → placa): JSON `{ "acao": "atualizar" }` ou `{ "acao": "reiniciar" }`.
- Servidor: `server/src/modules/frota/mqtt.ts` com `mqtt@5.10.3`, `MQTT_URL` (padrão `mqtt://mosquitto:1883`), reconexão automática; sem broker o servidor funciona normalmente (só loga). Ao receber telemetria: atualiza `online=true`, `ultimoContato`, `telemetria`, `buildAtualId` (de `versao`) e grava `TelemetriaDispositivo` no máximo 1 a cada 30 s por placa; limpeza diária de amostras com mais de 7 dias. `status offline` → `online=false`. Vigia: sem contato há 60 s → `online=false`.

## 3. HTTP do dispositivo (B01)
Autenticação por cabeçalhos `X-Dispositivo-Id` e `X-Dispositivo-Chave` (sem JWT; rotas em `server/src/modules/frota/dispositivo.ts`, com limite simples de 30 req/min por dispositivo):
- `GET /api/ota/verificar?versao=<buildId atual>` → `{ atualizar: false }` ou `{ atualizar: true, buildId, url: "/api/ota/firmware/<buildId>", tamanho, md5 }`. Só oferece builds `SUCESSO` com `artefatoOta`, da **mesma placa** do dispositivo e igual a `buildAlvoId`. Atualiza `ultimoContato`.
- `GET /api/ota/firmware/:buildId` → o binário `artefatoOta` (`application/octet-stream`, com `x-MD5`), só se for o alvo do dispositivo.
- `POST /api/ota/resultado` `{ buildId, ok, mensagem? }` → grava `statusOta`, `ultimaOta`; com `ok` define `buildAtualId`.

## 4. API da frota para o usuário (B01, `autenticar`; escrita ADMIN/DEV)
- `GET /dispositivos` → `DispositivoFrota[]`; `GET /dispositivos/:id` → `DispositivoFrota`.
- `POST /dispositivos` / `PUT /dispositivos/:id` passam a aceitar `projetoId?` (mantenha os campos atuais).
- `POST /dispositivos/:id/chave` → `ChaveGerada` (gera nova, invalida a anterior).
- `PUT /dispositivos/:id/alvo` `{ buildId: number | null }` → valida build SUCESSO, mesma placa, com `artefatoOta`.
- `POST /dispositivos/:id/comando` `{ acao: 'atualizar' | 'reiniciar' }` → publica no MQTT; 503 se o broker estiver fora.
- `GET /dispositivos/:id/telemetria?horas=24` → `AmostraTelemetria[]` (ordem crescente, no máximo 2000 pontos).
- `GET /dispositivos/:id/config.h` → arquivo `aic_config.h` para o firmware OTA com `#define AIC_DISPOSITIVO_ID`, `AIC_SERVIDOR_URL` (de `SERVIDOR_URL_PUBLICA`, padrão `http://<host da requisição>`), `AIC_MQTT_HOST`/`AIC_MQTT_PORTA` (de `MQTT_HOST_PUBLICO`, padrão o host da requisição, e `MQTT_PORTA`), `AIC_MQTT_USUARIO`/`AIC_MQTT_SENHA`, e `AIC_WIFI_SSID`/`AIC_WIFI_SENHA` vazios para o usuário preencher. Exige `?chave=<chave>` (o usuário cola a chave que acabou de gerar) — a chave **não** fica gravada em claro no servidor.
- Eventos: emitir `{ tipo: 'dispositivo', id, ... }` (acrescente `'dispositivo'` ao tipo do servidor em `lib/eventos.ts`) quando mudar online/telemetria/statusOta, para a tela atualizar ao vivo. **O tipo do cliente `EventoTrabalho` é do main** e passa a aceitar `tipo: 'dispositivo'`.

## 5. Build e firmware (B02)
- `projetos/build.ts` (`criarBuild`): escreve também `include/aic_versao.h` com `#define AIC_BUILD_ID <id do build>` (o id precisa existir antes de escrever: crie a linha e depois os arquivos, ou reserve o id).
- Builder (ESP32/S3): além do `firmware-merged.bin`, copia o `firmware.bin` da aplicação para `firmware-ota.bin` e devolve `artefatoOta` no callback (o callback do server grava em `Build.artefatoOta`).
- `projetos/modelos.ts` modelo `OTA` (ESP32/S3): `platformio.ini` com `lib_deps = knolleary/PubSubClient@2.8` e `bblanchon/ArduinoJson@7.2.1`; `src/main.cpp` com Wi-Fi (reconexão), MQTT (LWT `offline` retido, `online` ao conectar, assina `comando`), telemetria a cada 10 s (`rssi`, `heapLivre`, `uptimeS`, `temperatura` se `temperatureRead()` existir, `versao=AIC_BUILD_ID`), OTA por `HTTPUpdate` (consulta `/api/ota/verificar` a cada 1 h e ao receber `atualizar`; envia `/api/ota/resultado`), LED piscando enquanto conecta; `include/aic_config.h` de exemplo com os `#define` do §4 vazios e instruções; README do projeto explicando os passos. Placas sem Wi-Fi: o modelo OTA é recusado com 400 ("OTA só para ESP32 e ESP32-S3").

## 6. Cliente (B03)
- `client/src/modules/firmware/Dispositivos.tsx` vira a **Frota**: cartões com indicador online/offline (bolinha), último contato relativo, RSSI, versão atual × alvo, status da OTA; filtros (todos/online/offline); ações: Abrir, Gerar chave (Modal mostrando a chave uma vez + botão "Baixar aic_config.h"), Definir versão (Selecao com builds SUCESSO do projeto e da placa), Atualizar agora, Reiniciar.
- `client/src/modules/firmware/DetalheDispositivo.tsx` (`export function DetalheDispositivo()`) em `/app/dispositivos/:id` (menu false): cabeçalho, gráficos de RSSI e heap nas últimas 24 h (`GraficoLinha` com `maximo`/`formatar`), última telemetria (tabela chave/valor, incluindo extras), histórico de OTA (status/última), guia "Como colocar esta placa na frota" (passos com o projeto modelo OTA).
- Atualização ao vivo com `useEventosTrabalho` filtrando `tipo === 'dispositivo'`.

## 7. Infra, release e CI (B04)
- `docker-compose.yml`: serviço `mosquitto` (imagem acima, `mosquitto/` com `mosquitto.conf` e `entrypoint.sh`, volume `mosquitto`), envs do server (`MQTT_URL`, `MQTT_USUARIO`, `MQTT_SENHA`, `MQTT_HOST_PUBLICO`, `MQTT_PORTA`, `SERVIDOR_URL_PUBLICA`).
- `.env.example` e `instalar.sh`/`instalar.ps1`: gerar `MQTT_SENHA` aleatória; perguntar (opcional) o IP da máquina na rede para `MQTT_HOST_PUBLICO`/`SERVIDOR_URL_PUBLICA`.
- `.github/workflows/release-vscode.yml`: em tag `vscode-v*` (e `workflow_dispatch`) compila a extensão, gera o `.vsix`, cria/atualiza a Release do GitHub com o `.vsix` anexado; job de publicação no Marketplace com `vsce publish -p ${{ secrets.VSCE_PAT }}` que só roda se o secret existir. `extensions/vscode/package.json` versão `0.2.0` e `CHANGELOG.md` da extensão.

## 8. Documentação (B05)
README (recursos novos, sumário), `docs/FIRMWARE.md` (monitor serial, coleta, OTA e frota passo a passo), `docs/MODELOS.md` (áudio/KWS, aba Testar), `docs/ARQUITETURA.md` (fila, vigia, SSE, MQTT), `docs/API.md` (rotas novas das levas A e B), `docs/INTEGRACOES.md` (agente com ferramentas, release da extensão), `SECURITY.md` (segredos persistentes, troca de senha, chave dos dispositivos, MQTT), `docs/SUGESTOES.md` (o que foi feito), `CHANGELOG.md` (0.3.0).
