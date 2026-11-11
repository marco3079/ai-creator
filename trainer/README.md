# Trainer (TinyML)

Serviço FastAPI que treina modelos TinyML (DENSA, CNN1D, DS_CNN) com TensorFlow
e exporta para TFLite e para header C (`model_data.h`).

## Endpoints

- `GET /saude` → `{"ok": true}`
- `POST /treinos` → `202 {"aceito": true}`. Treina em segundo plano e avisa o
  servidor pelo `callbackUrl` (header `X-Interno-Token`) com EXECUTANDO, SUCESSO
  ou FALHA. O contrato do pedido está em `docs/plano/CONTRATOS.md` (§3).

Os arquivos ficam em `saidaDir` (dentro do volume `/data`): `model.tflite` e `model_data.h`.

## Rodar

Com Docker (pelo compose do projeto): o serviço `trainer` usa `DATA_DIR=/data`.

Testes (não precisam do TensorFlow, só do `para_header_c`):

```
cd trainer
python -m pytest -q
```
