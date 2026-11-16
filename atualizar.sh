#!/usr/bin/env sh
# Atualiza o AI Creator para o último commit do GitHub, pelo terminal (Linux e macOS).
#   sh atualizar.sh
# Faz, nesta ordem: cópia do banco em backups/, git pull --ff-only, docker compose up -d --build
# (o Compose reconstrói só o que mudou) e registra a versão no atualizador, que mostra a tela "Atualização".
# O mesmo pode ser feito pela tela: Sistema > Atualização > Atualizar agora.
set -eu
cd "$(dirname "$0")"

PASTA_BACKUPS="backups"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Esta pasta não é um repositório Git. Para atualizar, instale de novo com git clone."
  exit 1
fi

# 1) Cópia do banco antes de baixar o código
mkdir -p "$PASTA_BACKUPS"
copia="aicreator-$(date -u +%Y%m%d-%H%M%S).sql"
parcial="$PASTA_BACKUPS/$copia.parcial"
echo "Copiando o banco de dados..."
if ! docker compose exec -T db pg_dump -U aicreator -d aicreator --no-owner > "$parcial"; then
  rm -f "$parcial"
  echo "A cópia do banco falhou. Nada foi atualizado." >&2
  exit 1
fi
if [ ! -s "$parcial" ]; then
  rm -f "$parcial"
  echo "A cópia do banco veio vazia. Nada foi atualizado." >&2
  exit 1
fi
mv "$parcial" "$PASTA_BACKUPS/$copia"
# Ficam só as 5 cópias mais recentes (o nome tem data e hora, então a ordem alfabética é a cronológica).
ls -1 "$PASTA_BACKUPS" 2>/dev/null | grep -E '^aicreator-[0-9]{8}-[0-9]{6}\.sql$' | sort -r | tail -n +6 | while read -r antigo; do
  rm -f "$PASTA_BACKUPS/$antigo"
done
echo "Cópia do banco: $PASTA_BACKUPS/$copia"

# 2) Código novo do GitHub. --ff-only: só avança; se houver alteração local que conflite, para sem apagar nada.
ramo="$(git rev-parse --abbrev-ref HEAD)"
antes="$(git rev-parse HEAD)"
echo "Baixando a versão nova do GitHub (ramo $ramo)..."
git pull --ff-only origin "$ramo"
depois="$(git rev-parse HEAD)"

# 3) Reconstruir. Os perfis opcionais entram só se estiverem rodando.
perfis=""
rodando="$(docker compose --profile gpu --profile ollama ps --services --status running 2>/dev/null || true)"
if echo "$rodando" | grep -qx finetuner; then perfis="$perfis --profile gpu"; fi
if echo "$rodando" | grep -qx ollama; then perfis="$perfis --profile ollama"; fi
echo "Reconstruindo o sistema (pode levar alguns minutos)..."
# shellcheck disable=SC2086
docker compose $perfis up -d --build

# 4) Registra no atualizador a versão que está no ar (a tela compara com ela).
if docker compose exec -T atualizador sh -c 'git -C /projeto rev-parse HEAD > /dados/implantado.novo && mv /dados/implantado.novo /dados/implantado' >/dev/null 2>&1; then
  :
else
  echo "Aviso: não consegui registrar a versão no atualizador. A tela pode mostrar a versão como desconhecida."
fi

if [ "$antes" = "$depois" ]; then
  echo "O sistema já estava na última versão. Cópia do banco: $PASTA_BACKUPS/$copia"
else
  echo "Atualizado de $(echo "$antes" | cut -c1-7) para $(echo "$depois" | cut -c1-7). Cópia do banco: $PASTA_BACKUPS/$copia"
fi
