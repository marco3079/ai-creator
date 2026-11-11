# Builder

Serviço FastAPI (porta 8002) que compila projetos PlatformIO e grava firmware em ESP32 pela porta USB.

## Rotas

- `GET /saude` → `{ "ok": true }`
- `POST /builds` → 202. Corpo: `{ buildId, projetoDir, placa, saidaDir, callbackUrl, callbackToken }`. Compila em segundo plano com `pio run` e chama `callbackUrl` (header `X-Interno-Token`) com EXECUTANDO e depois SUCESSO ou FALHA.
- `POST /gravar` → `{ ok, log }`. Corpo: `{ artefato, placa, porta, offset? }`. Só ESP32/ESP32S3, e só com a porta USB mapeada no container.

## Volumes e cache

- `/data` é o volume compartilhado (`DATA_DIR`).
- `/root/.platformio` deve ser montado em volume para cachear as toolchains. A primeira compilação de cada placa baixa a toolchain e é lenta.
- Para gravar a partir do container no Linux, mapeie o dispositivo USB em `devices` no docker-compose.

## Testes

```
python -m pytest -q
```

Os testes cobrem apenas `app/placas.py` e não precisam do PlatformIO instalado.
