# Sugestões e roadmap

Ideias para as próximas versões, organizadas por prazo. Cada item traz o motivo e um escopo inicial. A prioridade pode mudar conforme o uso real.

## Curto prazo

- **OTA (gravação pela rede)**: atualizar o firmware de um ESP32 pelo Wi-Fi, sem cabo. Reduz a necessidade de ir até a placa a cada versão.
- **Monitor serial no navegador**: ler a saída serial da placa (Web Serial) dentro da plataforma, com filtro e botão de limpar. Ajuda a depurar sem abrir outro programa.
- **Coleta de dados direto da placa**: capturar amostras pelo Web Serial e salvar como dataset CSV, sem copiar à mão. Fecha o ciclo de coleta, rotulagem e treino.
- **Versionamento Git dos projetos**: guardar o histórico de cada projeto de firmware e de cada agente em um repositório Git, com exportação e importação.

## Médio prazo

- **Import e export com Edge Impulse**: trazer datasets e modelos de projetos Edge Impulse e exportar os modelos daqui para lá.
- **Model Zoo**: modelos prontos para tarefas comuns, como reconhecimento de palavras-chave (KWS), detecção de anomalia e visão de pessoas com ESP32-CAM.
- **Benchmark no dispositivo**: medir latência e uso de RAM do modelo na placa real e mostrar os números junto ao treino.
- **Colaboração e permissões por projeto**: convidar pessoas para um projeto específico, com permissões próprias, além dos perfis atuais.
- **Agentes LLM com ferramentas que chamam a plataforma**: um agente que escreve o firmware, compila e corrige os erros sozinho, usando as próprias rotas da API.
- **Avaliação de agentes**: conjuntos de teste com perguntas e respostas esperadas, notas automáticas e comparação entre versões do prompt.
- **Custos e uso de tokens por agente**: somar o consumo de cada agente e de cada provedor, com alerta de limite.
- **Filas com Redis e BullMQ**: trocar a fila atual de treinos e compilações por uma fila dedicada, para suportar mais jobs em paralelo e reinício sem perda.
- **Runners de build remotos ou self-hosted**: rodar as compilações em outras máquinas, para não depender de um único contêiner.

## Longo prazo

- **Assinatura de firmware e secure boot**: assinar os binários gerados e verificar a assinatura antes da gravação, em placas que suportam.
- **Frota de dispositivos com telemetria (MQTT)**: receber dados e estado de vários dispositivos em tempo real, com painel de saúde da frota.
- **Marketplace de agentes**: compartilhar agentes LLM e TinyML entre equipes e organizações, com versões e avaliações públicas.
- **Internacionalização (i18n)**: a interface em português já está pronta; faltam inglês e espanhol.
- **Testes E2E com Playwright**: cobrir os fluxos principais (login, criar agente, treinar, compilar) em cada pull request.

## Como sugerir

Abra uma issue com o modelo "Sugerir uma melhoria", no repositório. Diga qual problema a sugestão resolve e, se tiver, como imagina a solução. Veja [CONTRIBUTING.md](../CONTRIBUTING.md).
