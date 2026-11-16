#!/bin/sh
# Entrada do contêiner mosquitto: cria o arquivo de senhas e sobe o broker.
set -eu

if [ -z "${MQTT_USUARIO:-}" ] || [ -z "${MQTT_SENHA:-}" ]; then
  echo "erro: MQTT_USUARIO e MQTT_SENHA precisam estar definidos no arquivo .env." >&2
  exit 1
fi

mosquitto_passwd -b -c /mosquitto/config/senhas "$MQTT_USUARIO" "$MQTT_SENHA"
# O broker troca para o usuário "mosquitto" ao iniciar e precisa ler o arquivo
chown mosquitto:mosquitto /mosquitto/config/senhas
chmod 600 /mosquitto/config/senhas

exec mosquitto -c /mosquitto/config/mosquitto.conf
