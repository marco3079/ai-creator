FROM python:3.11-slim

# git e build-essential são exigidos pelo PlatformIO para compilar as toolchains.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git build-essential udev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Cache de toolchains do PlatformIO. O compose monta um volume em /root/.platformio
# para persistir esse cache; a primeira compilação de cada placa baixa a toolchain (lenta).
ENV PLATFORMIO_CORE_DIR=/root/.platformio

COPY app ./app

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
