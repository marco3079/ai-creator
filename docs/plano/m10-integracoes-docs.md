# m10 — MCP, Docker Compose, CI e documentação da área Modelos

Leia: `CONTRATOS-MODELOS.md` inteiro.

## Arquivos (só estes)
- `integrations/claude-code/mcp-server/src/index.ts` e `dist/` (recompilar), `integrations/claude-code/README.md`, `integrations/claude-code/commands/ai-treinar-modelo.md` (novo)
- `docker-compose.yml`, `.env.example`
- `.github/workflows/ci.yml`, `.github/dependabot.yml`
- `README.md` (seção nova "Modelos" em Recursos + linha na tabela de arquitetura/serviços + sumário), `docs/MODELOS.md` (novo), `docs/API.md`, `docs/ARQUITETURA.md`, `docs/INTEGRACOES.md`, `docs/SUGESTOES.md`, `CHANGELOG.md`

## Passos
1. MCP: 4 ferramentas novas do §8 (mesmo padrão das existentes; `modelo` aceita id ou slug; `treinar_modelo` devolve o treino criado; `status_treino_modelo` devolve status, métrica principal, `modeloResultante` e as últimas 60 linhas do log). Total 18. `npm run build`.
2. Comando `/ai-treinar-modelo`: instrui a escolher/criar o modelo e o dataset, treinar, acompanhar com `status_treino_modelo` e relatar métricas.
3. `docker-compose.yml`: serviço `finetuner` (build ./finetuner, `profiles: ["gpu"]`, volumes `dados:/data` e `hf:/root/.cache/huggingface`, `deploy.resources.reservations.devices: [{driver: nvidia, count: all, capabilities: [gpu]}]`, `restart: unless-stopped`); no `server`, `FINETUNER_URL: http://finetuner:8003`; volume `hf`. `.env.example` com `FINETUNER_URL` comentado. `docker compose config -q` e `docker compose --profile gpu --profile ollama config -q` precisam passar.
4. CI: job `finetuner` (python 3.11, `pip install httpx==0.27.2 pytest==8.3.2`, `python -m pytest -q`, working-directory finetuner); no job `trainer` instalar também `scikit-learn==1.5.1 pandas==2.2.2 joblib==1.4.2 m2cgen==0.10.0` e rodar `python -m pytest -q` (todos os testes que não exigem TF). Dependabot: pip em `/finetuner`.
5. `docs/MODELOS.md`: guia completo — conceito (modelo × treino × publicado), os 4 tipos com quando usar, formatos de dataset (CSV, zip de imagens, JSONL de conversas — com exemplos), fluxo de treino, comparação, como embutir no firmware (TinyML e `modelo_tabular.h` com código), ajuste fino OpenAI (custos, tempo, como usar o `ft:`), ajuste local (GPU, NVIDIA Container Toolkit, Ollama, limitações), exemplos em `exemplos/datasets/` (gestos.csv, formas.zip, temperatura.csv). README: seção curta "Modelos" em Recursos com link para `docs/MODELOS.md`, serviço `finetuner` na arquitetura (mermaid) e no sumário se precisar. `docs/API.md`: rotas novas (tabelas). `docs/ARQUITETURA.md`: fluxos (trainer, OpenAI worker, finetuner→Ollama). `docs/SUGESTOES.md`: marcar "treino de modelos" como feito e acrescentar próximos passos (KWS por áudio com MFCC, AutoML/busca de hiperparâmetros, rastreamento de experimentos estilo MLflow, avaliação de LLM ajustado). `CHANGELOG.md`: versão 0.2.0 com a área Modelos.

## Verificação
- `cd integrations/claude-code/mcp-server && npm run build` e teste `initialize` + `tools/list` = 18.
- `docker compose config -q`, `docker compose --profile gpu --profile ollama config -q`.
- Links internos dos .md existem.
