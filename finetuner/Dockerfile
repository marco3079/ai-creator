FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface

WORKDIR /srv

COPY requirements.txt .
# O torch padrão do PyPI no Linux já traz as bibliotecas CUDA.
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8003
CMD uvicorn app.main:app --host 0.0.0.0 --port 8003
