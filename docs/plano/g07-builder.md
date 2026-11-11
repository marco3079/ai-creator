# g07 — Builder (firmware) + servidor de projetos, builds e dispositivos

Leia antes: `docs/plano/CONTRATOS.md` (§1, §2 "Placas → PlatformIO", §3 "projetos / builds / dispositivos" e "API do builder").

## Arquivos que você pode criar/editar (só estes)
- `builder/` inteiro: `Dockerfile`, `.dockerignore`, `requirements.txt`, `app/__init__.py`, `app/main.py`, `app/compilar.py`, `app/gravar.py`, `app/placas.py`, `README.md`, `tests/test_placas.py`
- `server/src/modules/projetos/routes.ts`, `server/src/modules/projetos/modelos.ts`, `server/src/modules/projetos/caminhos.ts`
- `server/src/modules/builds/routes.ts`
- `server/src/modules/dispositivos/routes.ts`

## Passos — builder
1. `requirements.txt`: `fastapi==0.115.0`, `uvicorn==0.30.6`, `platformio==6.1.16`, `esptool==4.8.1`, `httpx==0.27.2`, `pytest==8.3.2`.
2. `Dockerfile`: `python:3.11-slim`; apt: `git build-essential udev` (sem recomendações); pip install; `ENV PLATFORMIO_CORE_DIR=/root/.platformio`; `EXPOSE 8002`; CMD uvicorn porta 8002. Comentário: o compose monta um volume em `/root/.platformio` para cachear toolchains; a primeira compilação de cada placa baixa a toolchain (lenta).
3. `app/placas.py`: dicionário `PLACAS` com a tabela do contrato (`platform, board, framework, artefato, offset, chip` — chip `esp32`/`esp32s3` para os ESP) e `def ini_para(placa) -> str` gerando o `platformio.ini` com `[env:principal]` (+ `monitor_speed = 115200`, e para ESP32/ESP32S3 `board_build.partitions = huge_app.csv`).
4. `app/compilar.py`: callback EXECUTANDO; `subprocess.run(['pio','run','-d',projetoDir], capture_output, timeout=900)`; envia log (stdout+stderr, cortado nos últimos 200 KB); procura em `<projetoDir>/.pio/build/principal/`: para ESP32/ESP32S3 roda `python -m esptool --chip <chip> merge_bin -o <saida>/firmware-merged.bin --flash_mode dio --flash_size 4MB <offsets> bootloader.bin partitions.bin firmware.bin` (bootloader em 0x1000 no ESP32, 0x0 no S3; partitions 0x8000; app 0x10000); demais placas copiam `firmware.uf2|bin|hex` conforme a tabela. Callback SUCESSO com `artefato` relativo a `/data`, `offset`, `tamanhoBytes`, ou FALHA com o log.
5. `app/gravar.py`: `POST /gravar` — ESP: `python -m esptool --chip <chip> --port <porta> --baud 921600 write_flash <offset> <artefato>`; demais: `pio run -d <projetoDir> -t upload --upload-port <porta>` não é possível sem o projeto, então para não-ESP retorne `{ok:false, log:'Gravação no servidor só para ESP32; use o VS Code ou o download.'}`. Se a porta não existir no container → `{ok:false, log:'Porta <x> não encontrada no container. No Linux, mapeie o dispositivo em docker-compose (devices).'}`.
6. `app/main.py`: `GET /saude`, `POST /builds` (BackgroundTasks, 202), `POST /gravar`.
7. `tests/test_placas.py`: `ini_para('ESP32')` contém `board = esp32dev` e `[env:principal]`; todas as 6 placas existem.

## Passos — server
8. `projetos/caminhos.ts`: `export function validarCaminho(c: string): string` (normaliza, recusa vazio, `..`, `\`, absoluto, > 200 chars → ErroHttp 400).
9. `projetos/modelos.ts`: `export function arquivosModelo(placa: Placa, nome: string): {caminho: string; conteudo: string}[]` — `platformio.ini` (mesmo conteúdo que `ini_para` do builder, gerado em TS), `src/main.cpp` (pisca LED do pino padrão: ESP32 GPIO2, S3 GPIO48 (RGB? use 2 mesmo), Nano33/Uno/Nucleo/Pico `LED_BUILTIN`, imprime "AI Creator: <nome>" na Serial), `include/README`, `lib/README`. Inclua também um exemplo comentado de como usar `model_data.h` com TFLite Micro no `main.cpp` (bloco `#if __has_include("model_data.h")` que só imprime `g_model_len`).
   `export function iniPara(placa: Placa): string`.
10. `projetos/routes.ts`, `builds/routes.ts`, `dispositivos/routes.ts`: todas as rotas do contrato. Build: grava os arquivos do banco em `caminhoDados('projetos', slug)` (apague a pasta antes com `fs.rmSync(..., {recursive:true, force:true})` — **preserve** a subpasta `.pio` se existir, para cache: apague só os demais itens), copia `model_data.h` do último treino do agente (se `agenteId`), chama `config.builderUrl + '/builds'`; se indisponível → FALHA "Serviço de compilação indisponível". Callback interno atualiza o Build. Downloads com `res.download(caminhoDados(build.artefato))`.

## Aceite / verificação
- `cd builder && python -m pytest -q` (só `placas`, sem PlatformIO instalado precisa passar).
- `cd server && npx tsc --noEmit` sem erros nos seus arquivos.
