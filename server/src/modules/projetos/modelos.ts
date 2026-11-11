// Arquivos-modelo dos projetos por placa. O platformio.ini segue a mesma tabela do builder (app/placas.py).

export const PLACAS_PROJETO = [
  'ESP32',
  'ESP32S3',
  'ARDUINO_NANO33BLE',
  'ARDUINO_UNO',
  'STM32_NUCLEO_F401RE',
  'RP2040_PICO',
] as const;

export type Placa = (typeof PLACAS_PROJETO)[number];

interface DadosPlaca {
  platform: string;
  board: string;
  framework: string;
  esp: boolean;
  pinoLed: string; // expressão C usada em PINO_LED
}

const DADOS_PLACA: Record<Placa, DadosPlaca> = {
  ESP32: { platform: 'espressif32', board: 'esp32dev', framework: 'arduino', esp: true, pinoLed: '2' },
  ESP32S3: { platform: 'espressif32', board: 'esp32-s3-devkitc-1', framework: 'arduino', esp: true, pinoLed: '2' },
  ARDUINO_NANO33BLE: { platform: 'nordicnrf52', board: 'nano33ble', framework: 'arduino', esp: false, pinoLed: 'LED_BUILTIN' },
  ARDUINO_UNO: { platform: 'atmelavr', board: 'uno', framework: 'arduino', esp: false, pinoLed: 'LED_BUILTIN' },
  STM32_NUCLEO_F401RE: { platform: 'ststm32', board: 'nucleo_f401re', framework: 'arduino', esp: false, pinoLed: 'LED_BUILTIN' },
  RP2040_PICO: { platform: 'raspberrypi', board: 'pico', framework: 'arduino', esp: false, pinoLed: 'LED_BUILTIN' },
};

// Gera o platformio.ini com [env:principal] (mesmo conteúdo de ini_para no builder).
export function iniPara(placa: Placa): string {
  const d = DADOS_PLACA[placa];
  const linhas = [
    '[env:principal]',
    `platform = ${d.platform}`,
    `board = ${d.board}`,
    `framework = ${d.framework}`,
    'monitor_speed = 115200',
  ];
  if (d.esp) {
    linhas.push('board_build.partitions = huge_app.csv');
  }
  return linhas.join('\n') + '\n';
}

// Texto para uso dentro de uma string C ("...") sem quebrar o código.
function textoC(texto: string): string {
  return texto
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function mainCpp(nome: string, pinoLed: string): string {
  return `// Projeto AI Creator: ${nome.replace(/[\r\n]+/g, ' ')}
// Pisca o LED da placa e imprime uma mensagem na Serial (115200).
#include <Arduino.h>

// Modelo TinyML opcional: o AI Creator grava include/model_data.h ao compilar um build com agente.
// Exemplo com TFLite Micro: tflite::GetModel(g_model) carrega o modelo a partir do array g_model.
#if __has_include("model_data.h")
#include "model_data.h"
#define TEM_MODELO 1
#endif

static const int PINO_LED = ${pinoLed};

void setup() {
  pinMode(PINO_LED, OUTPUT);
  Serial.begin(115200);
  delay(500);
  Serial.println("AI Creator: ${textoC(nome)}");
#ifdef TEM_MODELO
  Serial.print("Modelo embutido, bytes: ");
  Serial.println(g_model_len);
#endif
}

void loop() {
  digitalWrite(PINO_LED, HIGH);
  delay(500);
  digitalWrite(PINO_LED, LOW);
  delay(500);
}
`;
}

// Arquivos-modelo de um projeto novo (caminhos relativos à raiz do projeto).
export function arquivosModelo(placa: Placa, nome: string): { caminho: string; conteudo: string }[] {
  return [
    { caminho: 'platformio.ini', conteudo: iniPara(placa) },
    { caminho: 'src/main.cpp', conteudo: mainCpp(nome, DADOS_PLACA[placa].pinoLed) },
    {
      caminho: 'include/README',
      conteudo:
        'Cabeçalhos do projeto. O AI Creator coloca aqui o model_data.h do último treino ao compilar um build com agente.\n',
    },
    {
      caminho: 'lib/README',
      conteudo: 'Bibliotecas privadas do projeto. Cada subpasta é uma biblioteca do PlatformIO.\n',
    },
  ];
}
