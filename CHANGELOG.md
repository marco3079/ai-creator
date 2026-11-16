# Changelog

Todas as mudanças notáveis deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Planejado

- Ver as próximas ideias priorizadas em [docs/SUGESTOES.md](docs/SUGESTOES.md).

## [0.3.0] - 2026-11-16

### Adicionado

- **Fila de trabalhos** no PostgreSQL, com despachante e vigia: treinos e compilações entram em `FILA` e são enviados quando o serviço tem vaga. Se um serviço reiniciar, o trabalho perdido vira `FALHA` com a mensagem de reinício, e há tempo limite por tipo de trabalho.
- **Eventos ao vivo** por SSE (`GET /api/eventos`) para treinos, compilações e a frota. As telas atualizam sem recarregar a página.
- **Histórico do projeto**: versões manuais e automáticas (uma a cada compilação), comparação com a versão anterior ou com os arquivos atuais, restaurar com versão automática de segurança antes, e download como repositório Git (`GET /api/projetos/:id/git.zip`).
- **Monitor serial** no navegador (Web Serial), com escolha de velocidade.
- **Coleta de dados pela serial**: exemplos rotulados gravados da placa ou de um simulador, salvos como dataset de série temporal. Novo modelo de projeto **Coletor**.
- **Aba Testar** dos modelos TinyML e tabulares, que roda a versão no servidor com o mesmo arquivo que vai para a placa (`POST /api/treinos-modelo/:id/prever`).
- **Uso e custos**: registro de tokens e custo por execução de agente, resumo por agente e por modelo (`GET /api/uso/resumo`) e preços editáveis pelo administrador.
- **Agentes com ferramentas da plataforma** (`aic.*`): ler, editar e compilar o projeto vinculado, com Claude e OpenAI.
- **Áudio e palavra-chave**: tarefa `AUDIO` nos modelos TinyML, dataset do tipo `SONS` (`.zip` com `.wav`) e arquitetura DS-CNN. O treino gera `features_audio.h` para a placa.
- **Frota e OTA**: placas ESP32 e ESP32-S3 com o modelo **OTA** entram na frota, publicam telemetria por MQTT (broker `mosquitto`) e atualizam o firmware pelo Wi-Fi, com a versão alvo escolhida na tela da frota. A tela **Dispositivos** virou a frota, com detalhe por placa.
- **Troca de senha** no primeiro acesso, com `POST /api/auth/trocar-senha`.
- **Testes automatizados**: Vitest no servidor (job `server-testes` no CI) e E2E com Playwright na pasta `e2e/`.
- **Release da extensão do VS Code** por tag `vscode-v*`, com o `.vsix` anexado à Release do GitHub e publicação no Marketplace quando o segredo `VSCE_PAT` existe.
- Documentação: monitor serial, coleta, frota e OTA em [docs/FIRMWARE.md](docs/FIRMWARE.md); áudio e aba Testar em [docs/MODELOS.md](docs/MODELOS.md); fila e MQTT em [docs/ARQUITETURA.md](docs/ARQUITETURA.md); rotas novas em [docs/API.md](docs/API.md); agente com ferramentas e release da extensão em [docs/INTEGRACOES.md](docs/INTEGRACOES.md); segurança em [SECURITY.md](SECURITY.md).

### Alterado

- `POST /api/agentes/:id/treinar`, `POST /api/modelos/:id/treinar` e `POST /api/projetos/:id/build` só enfileiram: a resposta traz o treino ou a compilação em `FILA`, e o envio ao serviço é feito pelo despachante.
- `POST /api/projetos` aceita `modelo` (`BLINK`, `COLETOR` ou `OTA`).
- Imagem do `trainer` menor: `tensorflow-cpu` no lugar de `tensorflow`, com `tf-keras` instalado sem dependências.
- As telas são carregadas sob demanda (`lazy`), com um aviso de carregamento enquanto isso.

### Segurança

- `JWT_SECRET` e `INTERNO_TOKEN` com valor de exemplo ou ausente passam a ser gerados pelo servidor e guardados em `DATA_DIR/segredos.json`, com permissão restrita.
- O administrador com a senha padrão precisa trocá-la no primeiro acesso, e a mesma regra vale para usuários novos e senhas redefinidas.
- A chave de cada placa é guardada só como hash SHA-256.
- O broker MQTT não aceita conexões anônimas.
- As ferramentas do agente só agem dentro do projeto vinculado, e caminhos com `..` ou absolutos são recusados.

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
