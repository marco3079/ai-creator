# Finetuner (LLM local)

Serviço FastAPI que faz fine-tuning LoRA de modelos Llama 3.2 (1B ou 3B) com
PEFT + TRL e registra o adaptador no Ollama, para uso pelos agentes locais.

## O que faz

- Lê um dataset de conversas (`.jsonl`, uma conversa por linha, formato `messages`).
- Treina um adaptador LoRA sobre o modelo base em fp16 (GPU) ou fp32 (CPU).
- Grava `adapter_model.safetensors` e `adapter_config.json` em `saidaDir`.
- Cria no Ollama um modelo com o nome `nomeOllama` (base + adaptador).
- Avisa o servidor pelo callback (`X-Interno-Token`) com EXECUTANDO, SUCESSO ou FALHA.

## Endpoints

- `GET /saude` → `{"ok": true, "gpu": bool, "dispositivo": "cuda" | "cpu"}`
- `POST /treinos` → `202 {"aceito": true}`. Treina em segundo plano.

O contrato completo está em `docs/plano/CONTRATOS-MODELOS.md` (§6).

## Requisitos

- GPU NVIDIA com o NVIDIA Container Toolkit instalado no host.
- Sem GPU o serviço sobe, mas o treino roda na CPU e é muito lento.

## Subir

Pelo compose do projeto (perfil `gpu`):

```
docker compose --profile gpu up -d finetuner
```

Porta 8003. O Ollama é chamado em `http://ollama:11434` (configurável no pedido).
O cache do Hugging Face fica no volume `hf` (`/root/.cache/huggingface`).

## Tempo e memória (aproximados)

- Llama 3.2 1B com LoRA em fp16: cerca de 6 GB de VRAM.
- Llama 3.2 3B: mais memória; reduza `tamanhoLote` ou `comprimentoMax` se faltar VRAM.

## Limitações

- Nesta versão só aceita modelos base Llama 3.2 (`llama3.2:1b` e `llama3.2:3b`).
- O dataset precisa de pelo menos 10 conversas, com `user` e `assistant` e a última
  mensagem do `assistant`.

## Testes

Não precisam de torch:

```
cd finetuner
python -m pytest -q
```
