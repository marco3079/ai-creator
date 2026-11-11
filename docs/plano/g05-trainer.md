# g05 — Trainer (TinyML) + servidor de datasets e treinos

Leia antes: `docs/plano/CONTRATOS.md` (§1, §2 ConfigTinyml, §3 "datasets / treinos" e "API do trainer").

## Arquivos que você pode criar/editar (só estes)
- `trainer/` inteiro: `Dockerfile`, `.dockerignore`, `requirements.txt`, `app/main.py`, `app/treino.py`, `app/exportar.py`, `app/__init__.py`, `README.md`, `tests/test_exportar.py`
- `server/src/modules/datasets/routes.ts`, `server/src/modules/datasets/csv.ts`
- `server/src/modules/treinos/routes.ts`
- `exemplos/datasets/gestos.csv` (gerado por script) e `exemplos/datasets/gerar_gestos.py`

## Passos — trainer
1. `requirements.txt` com versões fixas: `fastapi==0.115.0`, `uvicorn==0.30.6`, `tensorflow-cpu==2.16.1`, `numpy==1.26.4`, `pandas==2.2.2`, `httpx==0.27.2`, `scikit-learn==1.5.1`, `pytest==8.3.2`.
2. `Dockerfile`: `python:3.11-slim`, `pip install --no-cache-dir -r requirements.txt`, `EXPOSE 8001`, `CMD uvicorn app.main:app --host 0.0.0.0 --port 8001`.
3. `app/main.py`: `GET /saude`; `POST /treinos` (pydantic do contrato) → `BackgroundTasks` chama `treino.executar(pedido)`; responde 202 `{aceito:true}`.
4. `app/treino.py`: callback EXECUTANDO; lê CSV com pandas (coluna `rotulo` + atributos), codifica rótulos na ordem de `config.classes` (se vazia, ordem alfabética), normaliza (média/desvio, salvos em metricas `normalizacao`), separa 80/20 estratificado. Modelos Keras:
   - `DENSA`: `camadas` × Dense(`neuronios`, relu) + Dropout(0.2) + Dense(n_classes, softmax).
   - `CNN1D`: reshape (janela, canais) → `camadas` × [Conv1D(neuronios, 3, relu) + MaxPool1D(2)] → GlobalAveragePooling1D → Dense softmax. Se colunas ≠ janela×canais, cai para DENSA e anota no log.
   - `DS_CNN`: igual CNN1D usando SeparableConv1D.
   Adam(`taxaAprendizado`), `epocas`, batch 32, early stopping (paciência 10). Acumula log por época (callback Keras) e manda a cada 5 épocas ao servidor (`log` é acrescentado). Métricas: acuracia, perda, acuraciaValidacao, matrizConfusao, classes.
5. `app/exportar.py`: `para_tflite(modelo, x_rep, quantizacao) -> bytes` (INT8 completo com dataset representativo de 100 amostras, entrada/saída int8; FLOAT32 sem otimização) e `para_header_c(dados: bytes, nome='g_model') -> str` (12 bytes por linha em hex, `alignas(16) const unsigned char g_model[] = {...}; const unsigned int g_model_len = N;`, com `#pragma once` e comentário de cabeçalho). Grava `model.tflite`/`model_data.h` em `saidaDir`, callback SUCESSO com caminhos **relativos a /data** e `tamanhoBytes`. Qualquer exceção → callback FALHA com o traceback no log.
6. `tests/test_exportar.py`: testa `para_header_c(b'\x01\x02')` (contém `0x01, 0x02` e `g_model_len = 2`).

## Passos — server
7. `datasets/csv.ts`: `export function analisarCsv(texto: string): { cabecalho: string[]; classes: string[]; amostras: number; colunas: number }` — valida cabeçalho começando com `rotulo`, todas as linhas com o mesmo nº de colunas, atributos numéricos; erros com número da linha (ErroHttp 400). Limite 20 MB.
8. `datasets/routes.ts` e `treinos/routes.ts` com todas as rotas do contrato. `POST /agentes/:id/treinar`: mescla `parametros` sobre `configTinyml` do agente, cria Treino (`parametros` = config final), chama `fetch(config.trainerUrl + '/treinos', ...)` com `csv: caminhoDados(dataset.caminhoArquivo)`, `saidaDir: caminhoDados('treinos', String(id))`, `callbackUrl: config.serverUrlInterno + '/api/interno/treinos/' + id`, `callbackToken: config.internoToken`. Se o trainer não responder → Treino FALHA com log "Serviço de treino indisponível". Downloads com `res.download`.

## Passos — exemplo
9. `exemplos/datasets/gerar_gestos.py` (só numpy): gera 300 amostras sintéticas de acelerômetro (3 canais × 50 pontos) para `parado`, `acenar` (senoide no eixo x), `circulo` (seno/cosseno em x/y) com ruído; escreve `gestos.csv` no formato do contrato. Rode e versione o CSV.

## Aceite / verificação
- `cd trainer && python -m pytest -q` (se o TensorFlow não estiver instalado no Windows, rode só o teste de `exportar` isolando a importação do TF dentro das funções que precisam dele; publique o que rodou).
- `python -I exemplos/datasets/gerar_gestos.py` gera o CSV.
- `cd server && npx tsc --noEmit` sem erros nos seus arquivos.
