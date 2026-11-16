FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# tf-keras sem as dependências: o pip não puxa o pacote 'tensorflow' completo (só o tensorflow-cpu).
RUN pip install --no-cache-dir --no-deps tf-keras==2.16.0

COPY app ./app

# Usa o Keras 2 (tf-keras 2.16) em vez do Keras 3: a conversão INT8 aborta com o Keras 3 e TF 2.16.
ENV TF_USE_LEGACY_KERAS=1

EXPOSE 8001
CMD uvicorn app.main:app --host 0.0.0.0 --port 8001
