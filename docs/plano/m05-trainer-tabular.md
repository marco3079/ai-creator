# m05 — Trainer: modelos clássicos (scikit-learn) com exportação para C

Leia: `CONTRATOS-MODELOS.md` §3 (algoritmos e hiperparâmetros) e §5 (TABULAR).

## Arquivos (só estes)
- `trainer/app/modelos/tabular.py`
- `trainer/requirements.txt` (acrescentar `joblib==1.4.2` e `m2cgen==0.10.0`)
- `trainer/tests/test_tabular.py`

## Passos
1. `def executar_tabular(pedido: dict, enviar) -> None` (assinatura fixa; o m04 chama). Lê o CSV (`pedido['dataset']['caminho']`), monta X/y, cria o estimador pelo `config.algoritmo` + tarefa (Classifier/Regressor; LINEAR→`Ridge`; LOGISTICA→`LogisticRegression`; SVM→`SVC`/`SVR`), aplica `hiperparametros` (converta tipos; ignore chaves desconhecidas com aviso no log), split, validação cruzada, treino, métricas (§5), grava `modelo.joblib` + `metricas.json` e, se for o caso, `modelo_tabular.h`.
2. Exportação C: `m2cgen.export_to_c(estimador)` gera `double score(double * input)` (regressão/binário) ou `void score(double * input, double * output)` (multiclasse). Gere um header com `#pragma once`, renomeie `score` → `aic_prever_bruto` (static) e exponha sempre `static inline void aic_prever(double* entrada, double* saida)` (escalar → `saida[0] = ...`). Com `normalizar`, exporte o estimador **sem** o scaler (`pipeline.steps[-1][1]`) e inclua `static const double aic_media[N]`, `aic_escala[N]` e `static inline void aic_normalizar(double* x)`. Classificação: `static const char* aic_classes[]` e `#define AIC_N_CLASSES`. Comentário no topo com a ordem das colunas e um exemplo de uso. Se o m2cgen falhar ou o algoritmo não exportar, log de aviso e segue sem header.
3. Use `enviar(status=..., log=..., metricas=..., artefatos=[...])` (caminhos relativos a `/data`). Grave o arquivo `"<saidaDir>/.final"` antes de mandar SUCESSO (o m04 usa isso para detectar morte do processo).
4. `tests/test_tabular.py`: com scikit-learn no venv, treina ÁRVORE (classificação) num CSV sintético pequeno em diretório temporário e confere métricas e que `modelo_tabular.h` contém `aic_prever` e `#pragma once`; RANDOM_FOREST regressão idem; KNN gera aviso e nenhum header. Use um `enviar` falso que acumula as chamadas.

## Verificação
- venv temporário com `numpy==1.26.4 pandas==2.2.2 scikit-learn==1.5.1 joblib==1.4.2 m2cgen==0.10.0 pytest==8.3.2`: `cd trainer && python -m pytest -q tests/test_tabular.py`.
- Compile um header gerado com `gcc -fsyntax-only -x c` dentro do container builder (`MSYS_NO_PATHCONV=1 docker compose exec -T builder gcc ...`, ele tem build-essential; copie o arquivo com `docker compose cp`). Publique.
