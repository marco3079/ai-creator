# Broker MQTT da frota com a configuração e a entrada do AI Creator dentro da imagem.
# Sem bind mount: o atualizador reconstrói este serviço pelo Compose, e um caminho relativo não existe no host.
FROM eclipse-mosquitto:2.0.20

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY entrypoint.sh /aic/entrypoint.sh
