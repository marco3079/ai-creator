# Sugestões e roadmap

Ideias para as próximas versões, organizadas por prazo. Cada item traz o motivo e um escopo inicial. A prioridade pode mudar conforme o uso real.

## Concluído

- **Treino de modelos** (versão 0.2.0): modelos TinyML, tabular, LLM na nuvem (OpenAI) e LLM local (LoRA com GPU e Ollama), com datasets de imagens e conversas, treinos numerados, publicação, embutir no firmware e ferramentas MCP. Veja [MODELOS.md](MODELOS.md).
- **OTA (gravação pela rede)** (versão 0.3.0): placas ESP32 e ESP32-S3 com o modelo OTA atualizam o firmware pelo Wi-Fi, com a versão alvo escolhida na frota. Veja [FIRMWARE.md](FIRMWARE.md#frota-e-ota).
- **Frota de dispositivos com telemetria (MQTT)** (versão 0.3.0): as placas publicam telemetria e status por um broker MQTT (`mosquitto`), com indicador online e offline, histórico de sinal e memória, e comandos de atualizar e reiniciar. Veja [ARQUITETURA.md](ARQUITETURA.md#frota-e-ota).
- **Versionamento Git dos projetos** (versão 0.3.0): cada projeto de firmware guarda versões manuais e automáticas (a cada compilação), com comparação, restauração e download como repositório Git. Veja [FIRMWARE.md](FIRMWARE.md#histórico-do-projeto).
- **Monitor serial no navegador** (versão 0.3.0): leitura da saída serial da placa pelo Web Serial, com escolha da velocidade. Veja [FIRMWARE.md](FIRMWARE.md#monitor-serial).
- **Coleta de dados pela serial** (versão 0.3.0): exemplos rotulados gravados pela placa ou por um simulador, salvos como dataset de série temporal. Veja [FIRMWARE.md](FIRMWARE.md#coletar-dados-pela-serial).
- **Agentes LLM com ferramentas da plataforma** (versão 0.3.0): o agente lê, edita e compila o projeto vinculado, nas ferramentas `aic.*`. Veja [INTEGRACOES.md](INTEGRACOES.md#agente-com-ferramentas-da-plataforma).
- **Custos e uso de tokens por agente e por provedor** (versão 0.3.0): resumo por agente e por modelo, com preços padrão e preços personalizados pelo administrador. Veja [API.md](API.md#uso-e-custos-apiuso).
- **KWS por áudio** (versão 0.3.0): modelo TinyML que reconhece palavras-chave em arquivos `.wav`, com as mesmas features na placa (micro-frontend do TFLite). Veja [MODELOS.md](MODELOS.md#áudio-e-palavra-chave).
- **Testar modelo antes de gravar** (versão 0.3.0): aba **Testar** com a mesma versão INT8 que vai para a placa. Veja [MODELOS.md](MODELOS.md#testar-antes-de-gravar).
- **Fila de trabalhos e eventos ao vivo** (versão 0.3.0): treinos e compilações entram numa fila no PostgreSQL, com despachante e vigia, e o andamento aparece ao vivo por SSE. A fila não usa Redis: a ideia de Redis e BullMQ continua em aberto, para escala. Veja [ARQUITETURA.md](ARQUITETURA.md#fila-de-trabalhos-e-vigia).
- **Segurança** (versão 0.3.0): segredos persistentes, troca de senha no primeiro acesso, chave por placa guardada só como hash e broker MQTT com usuário e senha. Veja [SECURITY.md](../SECURITY.md).
- **Testes automatizados e E2E** (versão 0.3.0): testes do servidor com Vitest, com job de CI próprio, e testes ponta a ponta com Playwright na pasta `e2e/`.

## Curto prazo

- **Versionamento dos agentes**: guardar o histórico de cada agente em um repositório Git, com exportação e importação. O histórico de projetos de firmware já está pronto (veja Concluído).

## Médio prazo

- **Import e export com Edge Impulse**: trazer datasets e modelos de projetos Edge Impulse e exportar os modelos daqui para lá.
- **Model Zoo**: modelos prontos para tarefas comuns, como detecção de anomalia e visão de pessoas com ESP32-CAM.
- **Benchmark no dispositivo**: medir latência e uso de RAM do modelo na placa real e mostrar os números junto ao treino.
- **Colaboração e permissões por projeto**: convidar pessoas para um projeto específico, com permissões próprias, além dos perfis atuais.
- **Avaliação de agentes**: conjuntos de teste com perguntas e respostas esperadas, notas automáticas e comparação entre versões do prompt.
- **Alerta de limite de custo**: avisar quando o consumo de um agente ou provedor passar de um limite definido. O resumo de custos já existe, mas o alerta ainda não.
- **Filas com Redis e BullMQ**: trocar a fila atual por uma fila dedicada, para suportar mais jobs em paralelo. A fila atual já guarda os trabalhos no PostgreSQL e se recupera depois de um reinício.
- **Runners de build remotos ou self-hosted**: rodar as compilações em outras máquinas, para não depender de um único contêiner.

## Próximos passos

- **MQTT com TLS e credencial por placa**: hoje o broker usa um usuário e senha para todas as placas, e o tráfego na rede local não é cifrado. A próxima etapa é cifrar a conexão e dar a cada placa a sua credencial.
- **AutoML e busca de hiperparâmetros**: testar combinações automaticamente dentro de um limite de tempo e indicar a melhor configuração do treino.
- **Rastreamento de experimentos (estilo MLflow)**: comparar treinos lado a lado, com parâmetros, métricas e gráficos guardados por modelo.
- **Avaliação de LLM ajustado**: conjunto de teste separado e comparação das respostas do modelo ajustado com as do modelo base.
- **Multi-tenant**: separar projetos, agentes, modelos e dispositivos por organização, para mais de um time usar a mesma instalação.

## Longo prazo

- **Assinatura de firmware e secure boot**: assinar os binários gerados e verificar a assinatura antes da gravação, em placas que suportam.
- **Marketplace de agentes**: compartilhar agentes LLM e TinyML entre equipes e organizações, com versões e avaliações públicas.
- **Internacionalização (i18n)**: a interface em português já está pronta; faltam inglês e espanhol.

## Como sugerir

Abra uma issue com o modelo "Sugerir uma melhoria", no repositório. Diga qual problema a sugestão resolve e, se tiver, como imagina a solução. Veja [CONTRIBUTING.md](../CONTRIBUTING.md).
