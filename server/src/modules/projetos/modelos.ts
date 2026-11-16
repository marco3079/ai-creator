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

export type ModeloProjeto = 'BLINK' | 'COLETOR' | 'OTA';

// Pinos analógicos dos 3 canais de coleta (sem MPU6050) por placa.
const PINOS_COLETA: Record<Placa, string> = {
  ESP32: '32, 33, 34',
  ESP32S3: '4, 5, 6',
  ARDUINO_NANO33BLE: 'A0, A1, A2',
  ARDUINO_UNO: 'A0, A1, A2',
  STM32_NUCLEO_F401RE: 'A0, A1, A2',
  RP2040_PICO: 'A0, A1, A2',
};

// Firmware de coleta (§6): imprime "# AIC-COLETA ..." e as linhas "v1,v2,v3" a 50 Hz.
// ESP32/S3 tenta o MPU6050 por Wire (0x68, registradores direto); sem ele lê 3 analógicas.
function coletaCpp(nome: string, placa: Placa): string {
  const esp = DADOS_PLACA[placa].esp;
  const cabecalhoMpu = esp
    ? `#include <Wire.h>
#define USA_MPU 1
`
    : '';
  const blocoMpu = esp
    ? `
#if defined(USA_MPU)
static const uint8_t MPU_ENDERECO = 0x68;

// Confirma o MPU6050 pelo WHO_AM_I (0x75 devolve 0x68) depois de acordá-lo (PWR_MGMT_1 = 0).
static bool mpuPresente() {
  Wire.beginTransmission(MPU_ENDERECO);
  Wire.write(0x6B);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delay(100);
  Wire.beginTransmission(MPU_ENDERECO);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(MPU_ENDERECO, (uint8_t)1);
  if (!Wire.available()) return false;
  return Wire.read() == 0x68;
}

static int16_t lerEixo16() {
  uint8_t alto = Wire.read();
  uint8_t baixo = Wire.read();
  return (int16_t)((alto << 8) | baixo);
}

// Acelerômetro X, Y, Z a partir de ACCEL_XOUT_H (0x3B), 6 bytes.
static void lerMpu(int32_t v[CANAIS]) {
  Wire.beginTransmission(MPU_ENDERECO);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ENDERECO, (uint8_t)6);
  v[0] = lerEixo16();
  v[1] = lerEixo16();
  v[2] = lerEixo16();
}
#endif
`
    : '';
  const pinos = PINOS_COLETA[placa];
  return `// Projeto AI Creator: ${nome.replace(/[\r\n]+/g, ' ')}
// Coleta de dados: imprime "# AIC-COLETA ..." (metadados) e uma linha "v1,v2,v3" a ${HZ_COLETA} Hz.
#include <Arduino.h>
${cabecalhoMpu}
static const int CANAIS = ${CANAIS_COLETA};
static const unsigned long HZ = ${HZ_COLETA};
static const unsigned long PERIODO_US = 1000000UL / HZ;
static const unsigned long PERIODO_META_MS = 2000;
static const int PINOS[CANAIS] = { ${pinos} };

static bool usaMpu = false;
static unsigned long proximaAmostraUs = 0;
static unsigned long ultimaMetaMs = 0;
${blocoMpu}
static void imprimirMeta() {
  Serial.print("# AIC-COLETA canais=");
  Serial.print(CANAIS);
  Serial.print(" hz=");
  Serial.print(HZ);
  Serial.print(" nomes=");
  Serial.println(usaMpu ? "ax,ay,az" : "a0,a1,a2");
}

static void lerSensores(int32_t v[CANAIS]) {
#if defined(USA_MPU)
  if (usaMpu) {
    lerMpu(v);
    return;
  }
#endif
  for (int i = 0; i < CANAIS; i++) {
    v[i] = analogRead(PINOS[i]);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
#if defined(USA_MPU)
  Wire.begin();
  usaMpu = mpuPresente();
#endif
  imprimirMeta();
  proximaAmostraUs = micros();
  ultimaMetaMs = millis();
}

void loop() {
  unsigned long agora = micros();
  if (agora - proximaAmostraUs < PERIODO_US) return;
  // Se o loop atrasou muito, recomeça do instante atual em vez de rajadas de amostras.
  if (agora - proximaAmostraUs > 4 * PERIODO_US) {
    proximaAmostraUs = agora;
  }
  proximaAmostraUs += PERIODO_US;

  if (millis() - ultimaMetaMs >= PERIODO_META_MS) {
    ultimaMetaMs = millis();
    imprimirMeta();
  }

  int32_t v[CANAIS];
  lerSensores(v);
  for (int i = 0; i < CANAIS; i++) {
    if (i > 0) Serial.print(',');
    Serial.print(v[i]);
  }
  Serial.println();
}
`;
}

const CANAIS_COLETA = 3;
const HZ_COLETA = 50;

// Arquivos-modelo de um projeto novo (caminhos relativos à raiz do projeto).
// modelo: BLINK (padrão), COLETOR (firmware de coleta da §6) ou OTA (por enquanto igual a BLINK).
export function arquivosModelo(
  placa: Placa,
  nome: string,
  modelo: ModeloProjeto = 'BLINK',
): { caminho: string; conteudo: string }[] {
  const codigo =
    modelo === 'COLETOR'
      ? coletaCpp(nome, placa)
      : mainCpp(nome, DADOS_PLACA[placa].pinoLed);
  return [
    { caminho: 'platformio.ini', conteudo: iniPara(placa) },
    { caminho: 'src/main.cpp', conteudo: codigo },
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
