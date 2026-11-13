#!/usr/bin/env sh
# Sobe o portal de gestão em segundo plano (macOS/Linux). Idempotente. Uso: sh gestao/iniciar.sh
# Porta: variável GESTAO_PORT (padrão 4317). A lógica está em gestao/painel.mjs (igual em todos os sistemas).
exec node "$(cd "$(dirname "$0")" && pwd)/painel.mjs" iniciar
