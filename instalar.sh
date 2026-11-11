#!/usr/bin/env bash
# Instalador do AI Creator para Linux e macOS.
#
# Uso:
#   bash instalar.sh               instala e sobe o sistema
#   bash instalar.sh --ollama      também sobe o Ollama (modelos locais)
#   bash instalar.sh --sem-perguntas   não pergunta as chaves de API
#
# Códigos de saída:
#   0 instalado | 2 Docker ausente | 3 Docker parado ou sem Compose
#   4 falha ao subir os contêineres | 5 a API não ficou saudável a tempo

set -eu

cd "$(dirname "$0")"

OLLAMA=0
PERGUNTAR=1
for arg in "$@"; do
  case "$arg" in
    --ollama) OLLAMA=1 ;;
    --sem-perguntas) PERGUNTAR=0 ;;
    -h|--ajuda)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $arg" >&2
      exit 1
      ;;
  esac
done

ARQUIVO_ENV=".env"

# Lê uma variável do .env (vazia se não existir)
ler_env() {
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$ARQUIVO_ENV"
}

# Grava ou troca uma variável no .env, mantendo a ordem do arquivo
gravar_env() {
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {print k"="v; achou=1; next} {print} END{if(!achou) print k"="v}' "$ARQUIVO_ENV" > "$ARQUIVO_ENV.tmp"
  mv "$ARQUIVO_ENV.tmp" "$ARQUIVO_ENV"
}

gerar_segredo() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

echo "== AI Creator: instalação =="

# 1) Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado."
  echo "Instale o Docker Desktop (https://www.docker.com/products/docker-desktop/), abra-o e rode este instalador de novo."
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "O Docker está instalado, mas não está rodando. Abra o Docker, espere iniciar e rode de novo."
  exit 3
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "O Docker Compose não está disponível. Atualize o Docker Desktop e rode de novo."
  exit 3
fi
echo "Docker OK."

# 2) Arquivo .env com segredos aleatórios (só cria se não existir)
if [ -f "$ARQUIVO_ENV" ]; then
  echo "Arquivo .env já existe; será mantido."
else
  cp .env.example "$ARQUIVO_ENV"
  gravar_env POSTGRES_PASSWORD "$(gerar_segredo)"
  gravar_env JWT_SECRET "$(gerar_segredo)"
  gravar_env INTERNO_TOKEN "$(gerar_segredo)"
  echo "Arquivo .env criado com segredos aleatórios."
fi

# 3) Chaves de LLM (opcionais)
if [ "$PERGUNTAR" = 1 ]; then
  if [ -z "$(ler_env ANTHROPIC_API_KEY)" ]; then
    printf "Chave da API Anthropic (Enter para pular): "
    read -r -s chave_anthropic || true
    echo
    [ -n "${chave_anthropic:-}" ] && gravar_env ANTHROPIC_API_KEY "$chave_anthropic"
  fi
  if [ -z "$(ler_env OPENAI_API_KEY)" ]; then
    printf "Chave da API OpenAI (Enter para pular): "
    read -r -s chave_openai || true
    echo
    [ -n "${chave_openai:-}" ] && gravar_env OPENAI_API_KEY "$chave_openai"
  fi
  unset chave_anthropic chave_openai 2>/dev/null || true
fi

# 4) Subir os contêineres
echo "Baixando e montando os contêineres (na primeira vez pode levar vários minutos)..."
if [ "$OLLAMA" = 1 ]; then
  docker compose --profile ollama up -d --build || { docker compose logs --tail 40; exit 4; }
else
  docker compose up -d --build || { docker compose logs --tail 40; exit 4; }
fi

# 5) Esperar a API ficar saudável
echo "Aguardando o servidor ficar pronto..."
id_servidor="$(docker compose ps -q server)"
saudavel=0
for _ in $(seq 1 60); do
  estado="$(docker inspect --format '{{.State.Health.Status}}' "$id_servidor" 2>/dev/null || echo ausente)"
  if [ "$estado" = "healthy" ]; then
    saudavel=1
    break
  fi
  sleep 3
done
if [ "$saudavel" != 1 ]; then
  echo "O servidor não ficou pronto a tempo. Veja: docker compose logs --tail 100 server"
  exit 5
fi

# 6) Resultado
porta_web="$(ler_env WEB_PORT)"
porta_web="${porta_web:-8080}"
email_admin="$(ler_env ADMIN_EMAIL)"
senha_admin="$(ler_env ADMIN_SENHA)"

echo
echo "AI Creator instalado e no ar."
echo "  Endereço:  http://localhost:${porta_web}"
echo "  Login:     ${email_admin:-admin@aicreator.local}"
echo "  Senha:     ${senha_admin:-trocar123}"
echo "Troque a senha em Meu perfil no primeiro acesso."
