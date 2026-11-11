# m04 — Trainer: endpoint de modelos e TinyML (regressão e imagens)

Leia: `CONTRATOS-MODELOS.md` §5 inteiro e o código atual de `trainer/app/` (main.py, treino.py, exportar.py — o processo filho e o Keras legado já existem; reaproveite).

## Arquivos (só estes)
- `trainer/app/main.py` (só acrescentar a rota `POST /modelos/treinos`)
- `trainer/app/modelos/__init__.py`, `trainer/app/modelos/executar.py` (processo filho, roteamento por tipo), `trainer/app/modelos/tinyml.py`, `trainer/app/modelos/callback.py`
- `trainer/tests/test_modelos_tinyml.py`
- `exemplos/datasets/gerar_imagens.py` + `exemplos/datasets/formas.zip` (gerado), `exemplos/datasets/gerar_regressao.py` + `exemplos/datasets/temperatura.csv` (gerado)

O m05 escreve `trainer/app/modelos/tabular.py` com `def executar_tabular(pedido: dict, enviar) -> None`. Seu `executar.py` importa e chama essa função quando `tipo == 'TABULAR'`.

## Passos
1. `callback.py`: `def criar_enviador(url, token)` → função `enviar(**campos)` (httpx, timeout 30 s, nunca lança — loga no stderr).
2. `executar.py`: `def executar(pedido: dict)` usado pela rota (BackgroundTasks): processo filho `multiprocessing.get_context('spawn')`. O filho grava o arquivo `"<saidaDir>/.final"` **antes** de mandar SUCESSO/FALHA; o pai, depois do `join()`, se o arquivo não existir, manda FALHA "O processo de treino terminou de forma inesperada (código X)". No filho: `enviar(status='EXECUTANDO')`, roteia TINYML→`tinyml.executar_tinyml(pedido, enviar)`, TABULAR→`tabular.executar_tabular(pedido, enviar)`; exceção → grava `.final` e manda FALHA com o traceback.
3. `tinyml.py`: `executar_tinyml(pedido, enviar)` com CLASSIFICACAO (reaproveite as funções de `app/treino.py`/`exportar.py`; não mude o comportamento do endpoint antigo `/treinos`), REGRESSAO e IMAGEM conforme §5. Artefatos, `metricas.principal` e `historico` conforme §5. Log por época em português. Também grava `.final` antes do SUCESSO.
4. Exemplos (sem dependências novas): `gerar_imagens.py` gera PNG em escala de cinza com Python puro (`zlib` + `struct`) e numpy: 3 classes (`circulo`, `quadrado`, `triangulo`), 40 imagens 64×64 por classe com posição/tamanho aleatórios e ruído; empacota em `formas.zip` (pastas por classe). `gerar_regressao.py` gera 400 linhas `rotulo,f0..f5` (temperatura futura a partir de 6 leituras, com ruído) em `temperatura.csv`. Rode com `python -I` e versione os arquivos gerados (zip < 1 MB).
5. `tests/test_modelos_tinyml.py`: testa funções puras (métricas de regressão, escolha de `principal`, montagem de artefatos) sem TensorFlow (importe TF só dentro das funções que precisam).

## Verificação
- `cd trainer && python -m pytest -q` (venv temporário com numpy + pytest).
- `docker compose build trainer && docker compose up -d trainer`. Copie um script de teste para o container (`MSYS_NO_PATHCONV=1 docker compose cp ... trainer:/tmp/t.py`) que extrai `formas.zip` em /tmp e chama `tinyml.executar_tinyml` para IMAGEM e para REGRESSAO com `temperatura.csv`, usando um `enviar` que só imprime. Publique o resumo (acurácia/r2 e tamanhos).
