# Firmware: projetos, compilação e gravação

O AI Creator guarda projetos PlatformIO, compila cada um em um contêiner próprio (`builder`) e entrega o binário. A gravação na placa pode ser feita de três jeitos: pelo navegador, pelo servidor ou pelo VS Code.

## Placas suportadas

| Placa | platform | board | Artefato | Offset de gravação |
|---|---|---|---|---|
| ESP32 | `espressif32` | `esp32dev` | `firmware-merged.bin` | `0x0` |
| ESP32-S3 | `espressif32` | `esp32-s3-devkitc-1` | `firmware-merged.bin` | `0x0` |
| Arduino Nano 33 BLE | `nordicnrf52` | `nano33ble` | `firmware.bin` | (não se aplica) |
| Arduino Uno | `atmelavr` | `uno` | `firmware.hex` | (não se aplica) |
| STM32 Nucleo F401RE | `ststm32` | `nucleo_f401re` | `firmware.bin` | `0x08000000` |
| Raspberry Pi Pico (RP2040) | `raspberrypi` | `pico` | `firmware.uf2` | (não se aplica) |

Todos os projetos usam a framework **Arduino** e um ambiente chamado `[env:principal]` no `platformio.ini`.

### Por que o ESP32 grava em `0x0`

O arquivo `firmware-merged.bin` já junta, na ordem certa, o bootloader, a tabela de partições e a aplicação:

- ESP32: bootloader em `0x1000`, tabela de partições em `0x8000` e aplicação em `0x10000`.
- ESP32-S3: bootloader em `0x0`, tabela de partições em `0x8000` e aplicação em `0x10000`.

Por isso a gravação de um arquivo único começa sempre em `0x0`. Não grave o `.bin` da aplicação sozinho nessas placas.

## Projetos

Um projeto tem a placa escolhida e uma pasta de arquivos com o padrão do PlatformIO:

```
platformio.ini
src/main.cpp
include/README
lib/README
```

Ao criar um projeto, a plataforma gera esses arquivos com a configuração da placa. O modelo inicial pode ser **Blink** (padrão, pisca o LED e imprime na serial), **Coletor** (coleta de dados pela serial, veja [Coletar dados pela serial](#coletar-dados-pela-serial)) ou **OTA** (atualização pela rede, veja [Frota e OTA](#frota-e-ota)). Trocar a placa do projeto reescreve só o `platformio.ini`.

No editor de **Projetos**, você edita os arquivos no navegador. Cada alteração salva vai para o servidor.

Projeto com agente TinyML: ao compilar e escolher o agente, a plataforma copia o `model_data.h` do último treino para `include/`, sem você precisar mexer nele. Veja [TINYML.md](TINYML.md).

## Compilação

1. Abra o projeto e clique em **Compilar**. Você pode escolher um agente TinyML para incluir o modelo.
2. A compilação entra na fila e passa a EXECUTANDO. O log aparece na tela e atualiza sozinho.
3. Em SUCESSO, o botão **Baixar firmware** entrega o artefato da tabela acima.
4. Em FALHA, leia o log: os erros do compilador aparecem no fim.

As compilações ficam listadas em **Compilações**, com status, placa e tamanho do binário.

## Gravação

### Pelo navegador (Web Serial)

Funciona com Chrome ou Edge, em computador, com a placa ligada por USB. A página usa a biblioteca `esptool-js` para gravar o ESP32.

1. Abra a compilação com status SUCESSO.
2. Use a opção de gravação pelo navegador e escolha a porta serial da placa na janela do navegador.
3. Espere a barra de progresso terminar. A placa reinicia sozinha.

Se a placa não aparecer, segure o botão BOOT do ESP32 durante o início da gravação. Para as outras placas, use o VS Code ou o PlatformIO no computador.

Em **Frota**, o botão **Detectar porta (Web Serial)** preenche a porta da placa quando o navegador consegue identificar o USB.

### Pelo servidor (Linux)

A gravação pelo servidor roda dentro do contêiner `builder`, e por isso precisa que a porta USB esteja mapeada nele. Isso só funciona em Linux.

1. No `docker-compose.yml`, descomente o bloco do `builder` que mapeia a porta:

   ```yaml
   devices:
     - "/dev/ttyUSB0:/dev/ttyUSB0"
   ```

   Ajuste o caminho para a porta da sua placa (por exemplo, `/dev/ttyACM0`).
2. Suba de novo com `docker compose up -d`.
3. Na compilação, informe a **Porta no servidor** (ex.: `/dev/ttyUSB0`) e clique em **Gravar pelo servidor**.

O servidor responde com o log da gravação. Se a porta não existir dentro do contêiner, o log mostra o erro.

No Windows e no macOS, o Docker não repassa a porta USB para o contêiner. Use o navegador ou o VS Code.

### Pelo VS Code

A extensão **AI Creator** grava com o PlatformIO instalado na sua máquina, com o comando `pio run -t upload`. O passo a passo está em [INTEGRACOES.md](INTEGRACOES.md).

## Dispositivos (Frota)

Em **Frota**, cadastre as placas da sua bancada: nome, placa, porta (opcional) e notas. Cada gravação feita pelo servidor atualiza a última gravação e a última compilação do dispositivo com aquela porta. As placas com o modelo OTA aparecem nessa mesma tela, na frota, com o status de cada uma (veja [Frota e OTA](#frota-e-ota)).

## Histórico do projeto

Cada projeto guarda versões do seu código, como um histórico de alterações. Abra o projeto no editor e clique em **Histórico**. O painel **Histórico do projeto** mostra a lista de versões (a mais recente primeiro), com a mensagem, o autor, a data e o build relacionado.

### Versões manuais e automáticas

- **Manual**: clique em **Salvar versão** e escreva uma mensagem de até 200 caracteres. A versão guarda o estado atual de todos os arquivos.
- **Automática**: ao enviar uma compilação, a plataforma salva uma versão com a mensagem `Compilação #<id>`. Ela não tem autor e fica ligada ao build. Assim, cada firmware gerado pode ser comparado com o código que o produziu.
- Se nada mudou desde a última versão, nenhuma nova versão é criada. Uma versão manual nesse caso é recusada pela API (409).

### Comparar

Escolha uma versão na lista e veja as alterações arquivo por arquivo, em verde (linhas que entraram) e vermelho (linhas que saíram). Em **Comparar com**, escolha:

- **Versão anterior**: compara com a versão logo antes da escolhida.
- **Arquivos atuais**: compara com o que está no editor agora.

A primeira versão é comparada com um projeto vazio.

### Restaurar

Em **Restaurar esta versão**, a plataforma pede confirmação. Antes de substituir os arquivos, ela salva uma versão automática com a mensagem `Antes de restaurar a v<n>`, para você poder voltar ao estado de antes. Depois, os arquivos atuais são substituídos pelos da versão escolhida.

### Baixar como repositório Git

**Baixar repositório Git** gera um arquivo `.zip` com um repositório Git do projeto: um commit por versão, na ordem em que foram salvas. O autor de cada commit é o autor da versão, ou `AI Creator` nas versões automáticas. Para ver o histórico, descompacte o arquivo e rode `git log` na pasta. É preciso ter pelo menos uma versão salva.

## Monitor serial

A tela **Monitor serial** (menu Firmware, em `/app/serial`) mostra no navegador a saída serial de uma placa ligada por USB. Ela usa o Web Serial, por isso funciona no Chrome ou no Edge, no computador.

1. Escolha a velocidade (baud). O padrão é 115200, a mesma dos projetos gerados pela plataforma.
2. Clique em conectar e escolha a porta na janela do navegador.
3. As linhas aparecem conforme a placa envia.

Feche o monitor antes de gravar a placa, senão a porta fica ocupada (veja [Solução de problemas](#solução-de-problemas)).

## Coletar dados pela serial

A tela **Coletar dados** (menu Dados, em `/app/coleta`) grava exemplos rotulados de um sinal e salva tudo como um dataset de série temporal (`SERIE_TEMPORAL`), pronto para treinar um modelo TinyML. Veja o formato do dataset em [MODELOS.md](MODELOS.md).

### Firmware de coleta

Crie um projeto com o modelo **Coletor**. Ele imprime uma linha de metadados a cada 2 segundos e, a 50 Hz, uma linha com as três leituras:

```
# AIC-COLETA canais=3 hz=50 nomes=ax,ay,az
123,-45,678
124,-44,676
```

- **ESP32 e ESP32-S3**: o firmware tenta um sensor MPU6050 ligado por I2C (endereço 0x68), lido direto pelos registradores, sem biblioteca externa. Sem o sensor, lê três entradas analógicas. Os nomes dos canais são `ax,ay,az` (MPU) ou `a0,a1,a2` (analógicas).
- **Demais placas**: três entradas analógicas, com os nomes `a0,a1,a2`.

### Modo simulador

Sem a placa, escolha **Simulador** na tela. Ele gera os sinais **parado**, **acenar** e **circulo**, com os canais `ax,ay,az`. Use-o para testar a coleta e o treino antes de ter a placa.

### Gravar e salvar

1. Escolha a fonte: **Placa** (Web Serial) ou **Simulador**.
2. Digite o rótulo do exemplo (a classe, por exemplo `acenar`) e a janela, em linhas por exemplo (padrão 50, máximo 1000).
3. Grave o exemplo e mantenha o movimento até a janela encher. Cada exemplo ocupa uma janela.
4. Repita para cada classe. Todos os exemplos precisam ter a mesma janela e o mesmo número de canais.
5. Salve como dataset, com o nome que você escolher. A tela envia o CSV ao servidor. Depois, treine um modelo TinyML com ele.

### Como vira o dataset

Cada exemplo vira uma linha do CSV: o rótulo na primeira coluna e, em seguida, `janela × canais` valores. Os canais ficam intercalados por amostra. Com janela 2 e três canais, a linha tem seis features (`f0` a `f5`):

```csv
rotulo,f0,f1,f2,f3,f4,f5
acenar,123,-45,678,130,-44,670
```

Com a janela padrão (50) e três canais, cada linha tem 150 features (`f0` a `f149`).

## Frota e OTA

Placas ESP32 e ESP32-S3 com o modelo de projeto **OTA** entram na frota. Elas se conectam ao Wi-Fi e ao broker MQTT, publicam telemetria a cada 10 segundos e recebem atualizações de firmware pelo Wi-Fi (OTA). Outras placas não aceitam o modelo: a API responde 400 com "OTA só para ESP32 e ESP32-S3".

### Passo a passo

1. **Crie o projeto com o modelo OTA**, para ESP32 ou ESP32-S3. O projeto traz `src/main.cpp`, um `include/aic_config.h` de exemplo e um README com os passos.
2. **Cadastre a placa na frota e gere a chave.** Em **Frota**, cadastre a placa, vincule o projeto OTA e clique em **Gerar chave**. A chave tem o formato `aicd_` seguido de 40 caracteres hexadecimais e aparece uma vez. Gerar outra chave invalida a anterior.
3. **Baixe o `aic_config.h`.** O botão **Baixar aic_config.h** usa a chave que você acabou de gerar. O arquivo traz o id da placa, o endereço do servidor, o broker MQTT e a chave. Coloque-o em `include/` do projeto, no lugar do exemplo.
4. **Preencha o Wi-Fi.** Em `aic_config.h`, preencha `AIC_WIFI_SSID` e `AIC_WIFI_SENHA`. Eles vêm vazios.
5. **Compile e grave a primeira vez por USB.** Compile o projeto e grave o `firmware-merged.bin` pelo navegador (Web Serial) ou pelo VS Code, como em [Gravação](#gravação). Só a primeira gravação precisa de cabo.
6. **Confira a placa na frota.** Em alguns segundos, a placa aparece como online, com o sinal Wi-Fi e a versão atual.
7. **Defina a versão alvo.** Em **Definir versão**, escolha uma compilação SUCESSO do mesmo projeto e da mesma placa. A lista mostra só builds com o firmware OTA gerado.
8. **Atualize.** Clique em **Atualizar agora** (o servidor envia o comando pelo MQTT) ou espere: a placa consulta o servidor a cada hora. Ela baixa o binário, atualiza e informa o resultado. O status aparece na frota e no detalhe da placa (**Reiniciar** pede à placa que reinicie, também pelo MQTT).

### Como a placa conversa com o servidor

A placa fala com o servidor por MQTT, nos tópicos abaixo. O prefixo é `aic/d/<dispositivoId>/`.

| Tópico | Sentido | Conteúdo |
|---|---|---|
| `telemetria` | placa → servidor | JSON com `rssi`, `heapLivre`, `uptimeS`, `temperatura` (se a placa informar), `versao` (id do build em execução) e `chave` |
| `status` | placa → servidor (retido) | `online`. Se a placa cair, o broker publica `offline` (Last Will) |
| `comando` | servidor → placa | `{ "acao": "atualizar" }` ou `{ "acao": "reiniciar" }` |

O servidor descarta a telemetria com chave errada e não guarda a chave na telemetria. Sem contato por 60 segundos, a placa aparece como offline.

Para a atualização, a placa usa a API `/api/ota`, com os cabeçalhos `X-Dispositivo-Id` e `X-Dispositivo-Chave` (sem login). São três rotas: `GET /api/ota/verificar` (há build novo para esta placa?), `GET /api/ota/firmware/<buildId>` (baixa o binário) e `POST /api/ota/resultado` (informa se a atualização deu certo). Cada placa tem limite de 30 requisições por minuto.

### Rede e portas

- A porta 1883 (`MQTT_PORTA`) precisa estar liberada no firewall do computador, só para a rede local. Não exponha o broker à internet.
- `SERVIDOR_URL_PUBLICA` e `MQTT_HOST_PUBLICO` são os endereços que a placa usa. Use o IP da máquina na rede, não `localhost` (dentro da placa, `localhost` é a própria placa). O instalador pergunta por esses endereços, se você quiser.
- O broker exige usuário e senha (`MQTT_USUARIO` e `MQTT_SENHA`), mas a conexão ainda não usa TLS: o tráfego na rede local é em texto puro.

### Solução de problemas da frota

- **A placa não aparece como online**: confira o Wi-Fi no `aic_config.h`, a porta 1883 no firewall e se `MQTT_HOST_PUBLICO` e `SERVIDOR_URL_PUBLICA` são o IP da máquina.
- **A placa conecta, mas não atualiza**: confirme que a versão alvo é um build SUCESSO do mesmo projeto e da mesma placa. O status da OTA mostra a mensagem de falha.
- **Chave antiga**: se você gerou outra chave, baixe o `aic_config.h` de novo e grave a placa com ele.

## Solução de problemas

- **Não compila com erro de biblioteca**: confira o nome e a versão no `lib_deps` do `platformio.ini`. O builder baixa as bibliotecas na primeira compilação e guarda o cache no volume `platformio`.
- **Gravação falha com "porta ocupada"**: feche o monitor serial e outros programas que usem a porta.
- **ESP32 não entra no modo de gravação**: segure o botão BOOT, pressione e solte o RESET, e solte o BOOT.
- **Modelo TinyML não cabe na placa**: veja a seção "Limites de memória" em [TINYML.md](TINYML.md).
