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

Ao criar um projeto, a plataforma gera esses arquivos com a configuração da placa. Trocar a placa do projeto reescreve só o `platformio.ini`.

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

Em **Dispositivos**, o botão **Detectar porta (Web Serial)** preenche a porta da placa quando o navegador consegue identificar o USB.

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

## Dispositivos

Em **Dispositivos**, cadastre as placas da sua bancada: nome, placa, porta (opcional) e notas. Cada gravação feita pelo servidor atualiza a última gravação e a última compilação do dispositivo com aquela porta.

## Solução de problemas

- **Não compila com erro de biblioteca**: confira o nome e a versão no `lib_deps` do `platformio.ini`. O builder baixa as bibliotecas na primeira compilação e guarda o cache no volume `platformio`.
- **Gravação falha com "porta ocupada"**: feche o monitor serial e outros programas que usem a porta.
- **ESP32 não entra no modo de gravação**: segure o botão BOOT, pressione e solte o RESET, e solte o BOOT.
- **Modelo TinyML não cabe na placa**: veja a seção "Limites de memória" em [TINYML.md](TINYML.md).
