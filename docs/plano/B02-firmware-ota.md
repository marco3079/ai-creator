# B02 — Firmware OTA, versão no build e artefato OTA no builder

Leia: `docs/plano/CONTRATOS-LEVA-B.md` §1, §2 (tópicos e formato), §3 (HTTP da placa), §5 (sua especificação), e o código de `server/src/modules/projetos/{modelos,build}.ts` e `builder/app/{compilar,placas,main}.py`.

## Arquivos (só estes)
- `server/src/modules/projetos/modelos.ts` (modelo `OTA` de verdade; recusa para placas sem Wi-Fi via função `modeloSuportado(placa, modelo)` exportada)
- `server/src/modules/projetos/build.ts` (escrever `include/aic_versao.h`)
- `server/src/modules/projetos/routes.ts` (**só** a validação em `POST /projetos`: `modelo === 'OTA'` com placa sem Wi-Fi → 400 "OTA só para ESP32 e ESP32-S3")
- `builder/app/compilar.py` (copiar `firmware.bin` → `firmware-ota.bin` para ESP32/S3 e mandar `artefatoOta` no callback), `builder/tests/test_compilar_ota.py`

## Passos
1. `modelos.ts` — firmware OTA (ESP32/S3) conforme §5, código C++ comentado em português, sem `delay` longo no `loop` (use `millis`). Use `WiFiClient` (HTTP) e a URL vinda de `AIC_SERVIDOR_URL`; cabeçalhos `X-Dispositivo-Id`/`X-Dispositivo-Chave` também no `HTTPUpdate` (`httpUpdate.update(cliente, url, ...)` com `http.addHeader` via `HTTPClient` + `httpUpdate.handleUpdate` — confira a API da versão do core que o PlatformIO baixar, `espressif32` 6.x / Arduino 2.x ou 3.x). `include/aic_config.h` de exemplo e `README.md` na raiz do projeto com os passos (gerar chave na tela Frota, baixar o `aic_config.h`, colocar o Wi-Fi, compilar, gravar a primeira vez por USB; depois as atualizações vão pela rede).
2. `build.ts`: depois de criar a linha do build (id conhecido), gravar `include/aic_versao.h` (`#pragma once` + `#define AIC_BUILD_ID <id>`) junto com os arquivos do projeto no disco.
3. `compilar.py`: para ESP32/ESP32S3, copiar `.pio/build/principal/firmware.bin` para `<saidaDir>/firmware-ota.bin` e incluir `artefatoOta` (relativo a /data) no callback de SUCESSO.

## Verificação
- `cd server && npx tsc --noEmit`.
- `cd builder && python -m pytest -q` (venv com pytest; teste puro da escolha/cópia do artefato OTA com arquivos falsos em pasta temporária).
- Compile o projeto OTA de ESP32 **e** de ESP32-S3 no container builder (gere os arquivos com `arquivosModelo` via `tsx`, copie com `docker compose cp` para `/tmp/ota-esp32` e rode `pio run -d ...`; `MSYS_NO_PATHCONV=1`). Precisa de `include/aic_config.h` e `include/aic_versao.h` de exemplo. Publique RAM/Flash e SUCCESS.
