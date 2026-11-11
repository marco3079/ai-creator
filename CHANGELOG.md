# Changelog

Todas as mudanças notáveis deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Planejado

- Ver as próximas ideias priorizadas em [docs/SUGESTOES.md](docs/SUGESTOES.md).

## [0.2.0] - 2026-11-11

### Adicionado

- Área **Modelos**: modelos independentes dos agentes, com tipos TinyML, tabular, LLM na nuvem (OpenAI) e LLM local (LoRA com GPU, registrado no Ollama). Cada treino é numerado, comparável e pode ser publicado.
- Treino de modelos TinyML (classificação, regressão e imagens com CNN 2D) e tabular (árvore, random forest, gradient boosting, logística, linear, KNN e SVM), com exportação para C.
- Serviço `finetuner` (perfil `gpu`) para ajuste fino local de LLM. Exige GPU NVIDIA e o NVIDIA Container Toolkit.
- Datasets de imagens (`.zip`, uma pasta por classe) e de conversas (`.jsonl`), com prévia.
- Embutir modelo treinado em projeto de firmware (`modeloTreinoId`).
- Criar agente LLM a partir de um treino de LLM.
- Servidor MCP com 4 ferramentas de modelos (18 no total) e o comando `/ai-treinar-modelo`.
- Guia [docs/MODELOS.md](docs/MODELOS.md) e rotas novas em [docs/API.md](docs/API.md).

### Alterado

- O `docker-compose.yml` ganhou o serviço `finetuner`, o volume `hf` e a variável `FINETUNER_URL` no `server`.
- O job `trainer` do CI roda todos os testes que não exigem TensorFlow. Novo job `finetuner`.
- Dependabot passa a monitorar `finetuner/`.

## [0.1.0] - 2026-11-11

### Adicionado

- Agentes LLM (Claude, OpenAI e Ollama): edição, versões, playground com streaming (SSE), conversas salvas e import/export no formato `.md` do Claude Code.
- Agentes TinyML: configuração de classificador, datasets em CSV, treino em segundo plano, métricas, matriz de confusão e download do `.tflite` e do `model_data.h`.
- Firmware: projetos PlatformIO com editor de arquivos, compilação em contêiner próprio, download do binário, dispositivos cadastrados e gravação por Web Serial ou pelo servidor (Linux).
- Placas: ESP32, ESP32-S3, Arduino Nano 33 BLE, Arduino Uno, STM32 Nucleo F401RE e RP2040 (Raspberry Pi Pico).
- Usuários com perfis ADMIN, DEV e LEITOR, tokens de API `aic_`, registro de atividades e painel com indicadores.
- Extensão do VS Code e servidor MCP com plugin do Claude Code.
- Instaladores `instalar.sh` e `instalar.ps1`, `docker-compose.yml` com os serviços `db`, `server`, `client`, `trainer`, `builder` e `ollama` (perfil opcional).
- Tema claro e escuro, uso no celular e instalação como app (PWA).
- Documentação em `docs/` e arquivos de contribuição.
