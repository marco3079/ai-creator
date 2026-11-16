import { config } from '../../lib/config';

// Gera o aic_config.h do firmware OTA (CONTRATOS-LEVA-B §4).
export interface DadosAicConfig {
  dispositivoId: number;
  chave: string; // a chave que o usuário acabou de colar (não fica gravada no servidor)
  protocolo: string; // protocolo da requisição, ex.: "http"
  host: string; // cabeçalho Host da requisição, ex.: "192.168.0.10:3333"
  hostname: string; // host sem porta, ex.: "192.168.0.10"
}

// String literal de C com escapes; octal de 3 dígitos evita ambiguidade com o caractere seguinte.
export function cString(valor: string): string {
  const escapado = valor
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`);
  return `"${escapado}"`;
}

export function montarAicConfigH(dados: DadosAicConfig): string {
  const servidor = config.servidorUrlPublica || `${dados.protocolo}://${dados.host}`;
  const mqttHost = config.mqttHostPublico || dados.hostname;
  const linhas = [
    '// aic_config.h gerado pelo AI Creator. Contém a chave do dispositivo e senhas: não compartilhe.',
    '#ifndef AIC_CONFIG_H',
    '#define AIC_CONFIG_H',
    '',
    `#define AIC_DISPOSITIVO_ID ${dados.dispositivoId}`,
    `#define AIC_DISPOSITIVO_CHAVE ${cString(dados.chave)}`,
    `#define AIC_SERVIDOR_URL ${cString(servidor)}`,
    `#define AIC_MQTT_HOST ${cString(mqttHost)}`,
    `#define AIC_MQTT_PORTA ${config.mqttPorta}`,
    `#define AIC_MQTT_USUARIO ${cString(config.mqttUsuario)}`,
    `#define AIC_MQTT_SENHA ${cString(config.mqttSenha)}`,
    '',
    '// Preencha com a rede Wi-Fi da placa.',
    `#define AIC_WIFI_SSID ${cString('')}`,
    `#define AIC_WIFI_SENHA ${cString('')}`,
    '',
    '#endif',
    '',
  ];
  return linhas.join('\n');
}
