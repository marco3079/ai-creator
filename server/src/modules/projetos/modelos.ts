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
export function iniPara(placa: Placa, modelo: ModeloProjeto = 'BLINK'): string {
  const d = DADOS_PLACA[placa];
  const linhas = [
    '[env:principal]',
    `platform = ${d.platform}`,
    `board = ${d.board}`,
    `framework = ${d.framework}`,
    'monitor_speed = 115200',
  ];
  if (modelo === 'OTA') {
    // min_spiffs.csv tem ota_0 e ota_1 (o HTTPUpdate precisa de partição OTA).
    linhas.push('board_build.partitions = min_spiffs.csv');
    linhas.push('lib_deps =', '    knolleary/PubSubClient@2.8', '    bblanchon/ArduinoJson@7.2.1');
  } else if (d.esp) {
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

// O modelo OTA só existe para placas com Wi-Fi (ESP32 e ESP32-S3).
export function modeloSuportado(placa: Placa, modelo: ModeloProjeto): boolean {
  if (modelo === 'OTA') {
    return DADOS_PLACA[placa].esp;
  }
  return true;
}

// Detecta projeto OTA pelo platformio.ini gravado (o modelo OTA traz lib_deps e min_spiffs.csv).
export function ehProjetoOta(platformioIni: string): boolean {
  return platformioIni.includes('PubSubClient') || platformioIni.includes('min_spiffs.csv');
}

// Firmware OTA (ESP32/ESP32-S3): Wi-Fi, MQTT (status, telemetria e comandos) e atualização pela rede (§5).
function otaCpp(nome: string): string {
  return `// Projeto AI Creator: ${nome.replace(/[\r\n]+/g, ' ')}
// Firmware OTA da frota: Wi-Fi, MQTT (status, telemetria e comandos) e atualização pela rede.
// Antes de compilar, preencha include/aic_config.h (baixe o arquivo pronto na tela Frota).
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "aic_config.h"

// AIC_BUILD_ID é gravado em include/aic_versao.h a cada build. Sem o arquivo (edição local), vale 0.
#if __has_include("aic_versao.h")
#include "aic_versao.h"
#else
#define AIC_BUILD_ID 0
#endif

// Algumas placas ESP32 não definem LED_BUILTIN; usa o GPIO 2 (LED da maioria dos devkits).
#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

static const unsigned long TELEMETRIA_MS = 10000UL;     // telemetria a cada 10 s
static const unsigned long VERIFICACAO_MS = 3600000UL;  // consulta ao servidor a cada 1 h
static const unsigned long RECONEXAO_WIFI_MS = 10000UL;
static const unsigned long RECONEXAO_MQTT_MS = 5000UL;
static const unsigned long PISCA_MS = 250UL;

WiFiClient clienteMqtt;
PubSubClient mqtt(clienteMqtt);
String topicoBase;
bool verificacaoPendente = true;  // verdadeiro no boot e ao receber "atualizar"
bool reiniciarPedido = false;     // verdadeiro ao receber "reiniciar"
unsigned long ultimaTelemetriaMs = 0;
unsigned long ultimaVerificacaoMs = 0;
unsigned long ultimaTentativaWifiMs = 0;
unsigned long ultimaTentativaMqttMs = 0;
unsigned long ultimoPiscaMs = 0;
bool ledLigado = false;

// Só conecta quando include/aic_config.h estiver preenchido.
static bool configurado() {
  return AIC_DISPOSITIVO_ID > 0 && strlen(AIC_DISPOSITIVO_CHAVE) > 0 && strlen(AIC_SERVIDOR_URL) > 0 &&
         strlen(AIC_MQTT_HOST) > 0 && strlen(AIC_WIFI_SSID) > 0;
}

// LED aceso com MQTT conectado; piscando enquanto conecta. Não bloqueia o loop.
static void atualizarLed(bool conectado) {
  if (conectado) {
    ledLigado = true;
  } else if (millis() - ultimoPiscaMs >= PISCA_MS) {
    ultimoPiscaMs = millis();
    ledLigado = !ledLigado;
  }
  digitalWrite(LED_BUILTIN, ledLigado ? HIGH : LOW);
}

// Identidade da placa nas chamadas HTTP ao servidor.
static void aplicarCabecalhos(HTTPClient& http) {
  http.addHeader("X-Dispositivo-Id", String(AIC_DISPOSITIVO_ID));
  http.addHeader("X-Dispositivo-Chave", AIC_DISPOSITIVO_CHAVE);
}

// Avisa o servidor o resultado da atualização (POST /api/ota/resultado).
static void enviarResultado(long buildId, bool ok, const String& mensagem) {
  JsonDocument doc;
  doc["buildId"] = buildId;
  doc["ok"] = ok;
  if (mensagem.length() > 0) {
    doc["mensagem"] = mensagem;
  }
  String corpo;
  serializeJson(doc, corpo);
  WiFiClient cliente;
  HTTPClient http;
  http.begin(cliente, String(AIC_SERVIDOR_URL) + "/api/ota/resultado");
  aplicarCabecalhos(http);
  http.addHeader("Content-Type", "application/json");
  int codigo = http.POST(corpo);
  Serial.print("Resultado da OTA enviado, HTTP ");
  Serial.println(codigo);
  http.end();
}

// Baixa e grava o firmware (GET /api/ota/firmware/<buildId>) e depois avisa o servidor.
static void executarAtualizacao(const String& url, long buildId) {
  Serial.print("Atualizando para o build ");
  Serial.println(buildId);
  WiFiClient cliente;
  HTTPUpdate atualizador;
  atualizador.rebootOnUpdate(false);  // o reinício só acontece depois de avisar o servidor
  t_httpUpdate_return resultado = atualizador.update(cliente, url, String(AIC_BUILD_ID), [](HTTPClient* http) {
    aplicarCabecalhos(*http);
  });
  if (resultado == HTTP_UPDATE_OK) {
    enviarResultado(buildId, true, "");
    Serial.println("Firmware gravado, reiniciando");
    delay(300);
    ESP.restart();
    return;
  }
  String motivo = resultado == HTTP_UPDATE_NO_UPDATES ? String("Servidor nao devolveu o firmware")
                                                      : atualizador.getLastErrorString();
  enviarResultado(buildId, false, motivo);
}

// Pergunta ao servidor se há build alvo diferente do atual (GET /api/ota/verificar).
static void verificarAtualizacao() {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = String(AIC_SERVIDOR_URL) + "/api/ota/verificar?versao=" + String(AIC_BUILD_ID);
  WiFiClient cliente;
  HTTPClient http;
  http.begin(cliente, url);
  aplicarCabecalhos(http);
  int codigo = http.GET();
  if (codigo != HTTP_CODE_OK) {
    Serial.print("Verificacao de atualizacao falhou, HTTP ");
    Serial.println(codigo);
    http.end();
    return;
  }
  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, http.getStream());
  http.end();
  if (erro || !(doc["atualizar"] | false)) return;
  long buildId = doc["buildId"] | 0L;
  String caminho = doc["url"] | "";
  if (buildId <= 0 || caminho.length() == 0) return;
  executarAtualizacao(String(AIC_SERVIDOR_URL) + caminho, buildId);
}

// Comandos recebidos em aic/d/<id>/comando: só marca o pedido; quem executa é o loop.
static void aoReceberComando(char*, byte* payload, unsigned int tamanho) {
  JsonDocument doc;
  if (deserializeJson(doc, (const char*)payload, tamanho) != DeserializationError::Ok) return;
  const char* acao = doc["acao"] | "";
  if (strcmp(acao, "atualizar") == 0) {
    verificacaoPendente = true;
  } else if (strcmp(acao, "reiniciar") == 0) {
    reiniciarPedido = true;
  }
}

static void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - ultimaTentativaWifiMs < RECONEXAO_WIFI_MS) return;
  ultimaTentativaWifiMs = millis();
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(AIC_WIFI_SSID);
  WiFi.begin(AIC_WIFI_SSID, AIC_WIFI_SENHA);
}

// Conecta ao broker com Last Will "offline" (retido); ao conectar publica "online" e assina comando.
static void conectarMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - ultimaTentativaMqttMs < RECONEXAO_MQTT_MS) return;
  ultimaTentativaMqttMs = millis();
  String idCliente = "aic-" + String(AIC_DISPOSITIVO_ID);
  String topicoStatus = topicoBase + "status";
  String topicoComando = topicoBase + "comando";
  if (!mqtt.connect(idCliente.c_str(), AIC_MQTT_USUARIO, AIC_MQTT_SENHA, topicoStatus.c_str(), 1, true, "offline")) {
    Serial.print("MQTT sem conexao, estado ");
    Serial.println(mqtt.state());
    return;
  }
  mqtt.publish(topicoStatus.c_str(), "online", true);
  mqtt.subscribe(topicoComando.c_str(), 1);
  Serial.println("MQTT conectado");
}

// Telemetria (TelemetriaPlaca) com a chave da placa; a chave não é guardada em claro no servidor.
static void publicarTelemetria() {
  JsonDocument doc;
  doc["rssi"] = WiFi.RSSI();
  doc["heapLivre"] = ESP.getFreeHeap();
  doc["uptimeS"] = millis() / 1000UL;
  doc["temperatura"] = temperatureRead();
  doc["versao"] = AIC_BUILD_ID;
  doc["chave"] = AIC_DISPOSITIVO_CHAVE;
  char corpo[320];
  size_t tamanho = serializeJson(doc, corpo, sizeof(corpo));
  String topico = topicoBase + "telemetria";
  mqtt.publish(topico.c_str(), (const uint8_t*)corpo, tamanho, false);
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  delay(500);
  Serial.println("AI Creator: ${textoC(nome)}");
  topicoBase = "aic/d/" + String(AIC_DISPOSITIVO_ID) + "/";
  mqtt.setServer(AIC_MQTT_HOST, AIC_MQTT_PORTA);
  mqtt.setCallback(aoReceberComando);
  mqtt.setBufferSize(512);
  if (!configurado()) {
    Serial.println("Preencha include/aic_config.h (baixe pela tela Frota) e grave de novo.");
    return;
  }
  Serial.print("Build atual: ");
  Serial.println(AIC_BUILD_ID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(AIC_WIFI_SSID, AIC_WIFI_SENHA);
  ultimaTentativaWifiMs = millis();
}

void loop() {
  unsigned long agora = millis();
  if (!configurado()) {
    atualizarLed(false);
    return;
  }
  conectarWifi();
  conectarMqtt();
  mqtt.loop();

  if (WiFi.status() == WL_CONNECTED && (verificacaoPendente || agora - ultimaVerificacaoMs >= VERIFICACAO_MS)) {
    verificacaoPendente = false;
    ultimaVerificacaoMs = agora;
    verificarAtualizacao();
  }
  if (mqtt.connected() && agora - ultimaTelemetriaMs >= TELEMETRIA_MS) {
    ultimaTelemetriaMs = agora;
    publicarTelemetria();
  }
  if (reiniciarPedido) {
    Serial.println("Reiniciando por comando do servidor");
    delay(200);
    ESP.restart();
  }
  atualizarLed(mqtt.connected());
}
`;
}

const CONFIG_OTA_EXEMPLO = `// Configuração da placa (exemplo). Na tela Frota, gere a chave da placa e baixe o aic_config.h pronto.
// Preencha AIC_WIFI_SSID e AIC_WIFI_SENHA antes de gravar.
#pragma once

#define AIC_DISPOSITIVO_ID 0
#define AIC_DISPOSITIVO_CHAVE ""
#define AIC_SERVIDOR_URL ""
#define AIC_MQTT_HOST ""
#define AIC_MQTT_PORTA 1883
#define AIC_MQTT_USUARIO ""
#define AIC_MQTT_SENHA ""
#define AIC_WIFI_SSID ""
#define AIC_WIFI_SENHA ""
`;

function readmeOta(nome: string): string {
  return `# ${nome.replace(/[\r\n]+/g, ' ')}

Firmware OTA da frota do AI Creator (ESP32 ou ESP32-S3).

## Como colocar a placa na frota

1. Na tela Frota, cadastre a placa com este projeto e clique em Gerar chave. A chave aparece uma vez só.
2. Clique em Baixar aic_config.h e substitua o include/aic_config.h deste projeto pelo arquivo baixado.
3. Preencha AIC_WIFI_SSID e AIC_WIFI_SENHA com a rede Wi-Fi da placa (o arquivo baixado já traz o servidor e o broker MQTT).
4. Compile o projeto e grave a primeira vez por USB. Essa gravação também troca a tabela de partições para min_spiffs.csv (dois slots de aplicação, ota_0 e ota_1). Por isso a primeira gravação precisa ser por USB.
5. Depois disso, as atualizações chegam pela rede. Na tela Frota, use Definir versão e Atualizar agora. A placa também consulta o servidor a cada 1 hora.

## Comportamento

- Telemetria (sinal Wi-Fi, memória livre, tempo ligada, temperatura e versão) a cada 10 s, no tópico aic/d/<id>/telemetria.
- Status online/offline no tópico aic/d/<id>/status. Se a placa cair, o broker publica offline.
- Comandos no tópico aic/d/<id>/comando: atualizar e reiniciar.
- O LED fica aceso com o MQTT conectado e pisca enquanto conecta.

## Arquivos

- src/main.cpp: firmware.
- include/aic_config.h: identidade, servidor e Wi-Fi da placa. Não compartilhe a chave.
- include/aic_versao.h: gerado pelo AI Creator a cada build (AIC_BUILD_ID). Não edite.
`;
}

// Arquivos extras do modelo OTA (config de exemplo e README).
function arquivosOta(nome: string): { caminho: string; conteudo: string }[] {
  return [
    { caminho: 'include/aic_config.h', conteudo: CONFIG_OTA_EXEMPLO },
    { caminho: 'README.md', conteudo: readmeOta(nome) },
  ];
}

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
// modelo: BLINK (padrão), COLETOR (firmware de coleta da §6) ou OTA (firmware da frota, §5; só ESP32/S3).
export function arquivosModelo(
  placa: Placa,
  nome: string,
  modelo: ModeloProjeto = 'BLINK',
): { caminho: string; conteudo: string }[] {
  const codigo =
    modelo === 'COLETOR'
      ? coletaCpp(nome, placa)
      : modelo === 'OTA'
        ? otaCpp(nome)
        : mainCpp(nome, DADOS_PLACA[placa].pinoLed);
  const extras = modelo === 'OTA' ? arquivosOta(nome) : [];
  return [
    { caminho: 'platformio.ini', conteudo: iniPara(placa, modelo) },
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
    ...extras,
  ];
}
