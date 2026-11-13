#!/usr/bin/env sh
# Para o portal de gestão (macOS/Linux). Idempotente. Uso: sh gestao/parar.sh
exec node "$(cd "$(dirname "$0")" && pwd)/painel.mjs" parar
