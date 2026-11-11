# m06 — Serviço finetuner (LoRA local + Ollama)

Leia: `CONTRATOS-MODELOS.md` §6 (sua especificação) e §1. Estilo: igual ao `trainer/` (FastAPI, processo filho, callbacks com `X-Interno-Token`).

## Arquivos (só estes)
- `finetuner/` inteiro: `Dockerfile`, `.dockerignore`, `requirements.txt`, `README.md`, `app/__init__.py`, `app/main.py`, `app/treino.py`, `app/ollama.py`, `app/dados.py`, `tests/test_dados.py`, `tests/test_ollama.py`

## Passos
1. `requirements.txt` com as versões do §6. `Dockerfile`: `python:3.11-slim`, `pip install --no-cache-dir -r requirements.txt` (o torch padrão do PyPI no Linux já traz CUDA), `ENV HF_HOME=/root/.cache/huggingface`, `EXPOSE 8003`, CMD uvicorn porta 8003.
2. `app/dados.py`: `carregar_conversas(caminho) -> list[dict]` (valida como o server) e `formatar(conversas, tokenizer, prompt_sistema)` (insere `system` quando faltar e `prompt_sistema` não for vazio; usa `tokenizer.apply_chat_template(..., tokenize=False)`).
3. `app/ollama.py`: `sha256_arquivo(caminho)`, `enviar_blob(url, caminho)` (`HEAD /api/blobs/<digest>` → se 404, `POST` com o arquivo), `garantir_base(url, modelo)` (`POST /api/pull {model, stream:false}`, timeout longo) e `registrar_adaptador(url, nome, base, arquivos: dict[nome, caminho], sistema)` (`POST /api/create`, §6). Funções separadas e testáveis com um servidor HTTP falso.
4. `app/treino.py`: `executar(pedido)` no processo filho: EXECUTANDO; carrega tokenizer/modelo HF (base do §6) em fp16 com CUDA ou fp32 no CPU (avise no log que no CPU é muito lento); LoRA (PEFT) + `SFTTrainer` (TRL 0.12: `SFTConfig(output_dir=tmp, num_train_epochs, per_device_train_batch_size, learning_rate, max_seq_length, logging_steps=1, save_strategy='no', report_to=[])`); callback `TrainerCallback.on_log` manda a perda no log e no `historico`; salva o adaptador em `saidaDir`; registra no Ollama; SUCESSO com o contrato. Arquivo `.final` como no trainer. `app/main.py`: `/saude` e `/treinos` (BackgroundTasks + processo `spawn`, o pai manda FALHA se o filho morrer).
5. `README.md`: o que faz, requisito de GPU NVIDIA + NVIDIA Container Toolkit, como subir (`docker compose --profile gpu up -d finetuner`), tempo/VRAM aproximados (1B ~6 GB com LoRA fp16), limitações (só modelos Llama 3.2 nesta versão).
6. Testes sem torch: `test_dados.py` (validação/formatação com um tokenizer falso que tem `apply_chat_template`) e `test_ollama.py` (servidor falso com `http.server` em thread confirmando o fluxo blobs → create).

## Verificação
- venv temporário com `httpx==0.27.2 pytest==8.3.2`: `cd finetuner && python -m pytest -q`.
- **Não** construa a imagem (é grande e o compose é do m10); só `python -I -m py_compile app/*.py`.
