# A02 — Serviços Python: trabalhos ativos, prever e imagem do trainer menor

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §3 e o código de `trainer/app`, `builder/app`, `finetuner/app`.

## Arquivos (só estes)
- trainer: `trainer/app/main.py`, `trainer/app/ativos.py` (novo), `trainer/app/modelos/prever.py` (novo), `trainer/Dockerfile`, `trainer/requirements.txt`, `trainer/tests/test_ativos.py`, `trainer/tests/test_prever.py`
- builder: `builder/app/main.py`, `builder/app/ativos.py` (novo), `builder/tests/test_ativos.py`
- finetuner: `finetuner/app/main.py`, `finetuner/app/ativos.py` (novo), `finetuner/tests/test_ativos.py`
NÃO edite `trainer/app/modelos/tinyml.py` nem `tabular.py`. `trainer/app/modelos/audio.py` é do A10 (importe só dentro da função, quando a tarefa for AUDIO).

## Passos
1. `ativos.py` (igual nos 3, ajustando o tipo): `marcar(tipo, id)`, `desmarcar(tipo, id)`, `listar() -> dict`. No `main.py`, marcar ao aceitar o pedido e desmarcar no `finally` da tarefa em segundo plano (depois do `join` do processo filho). `GET /trabalhos`.
2. `prever.py` + rota `POST /modelos/prever` (§3). Confira as chaves reais de normalização lendo `trainer/app/treino.py` (CLASSIFICACAO de série temporal, `normalizacao` com média/desvio) e `trainer/app/modelos/tinyml.py` (REGRESSAO: `normalizacao.atributos` e `normalizacao.rotulo`; IMAGEM: o modelo já tem `Rescaling`, entrada em 0–255). Classes vêm de `metricas.json` (`classes`). Probabilidades: softmax já está no modelo — use a saída desquantizada; ordene da maior para a menor. Meça `latenciaMs` só do `invoke()`.
3. Imagem menor (`requirements.txt` + `Dockerfile`): `tensorflow-cpu==2.16.2`; tirar `tf-keras` do requirements e instalar no Dockerfile com `pip install --no-cache-dir --no-deps tf-keras==2.16.0`. Mantenha `TF_USE_LEGACY_KERAS=1`.
4. Testes sem TensorFlow: `test_ativos.py` (marcar/desmarcar/listar com threads) nos 3 serviços; `test_prever.py` para as funções puras (normalizar, quantizar/desquantizar com scale/zero_point de exemplo, ordenar probabilidades).

## Verificação
- `python -m pytest -q` em cada serviço (venv temporário com numpy + pytest + httpx; no trainer, as dependências que os testes pedirem).
- `docker compose build trainer` e anote o tamanho (`docker images ai-creator-trainer`) antes/depois. Dentro do container (`MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T trainer python -c "..."`) treine um modelo Keras minúsculo e converta para INT8 (prove que o tf-keras sem deps funciona). Publique os números.
- Não suba nem derrube outros containers.
