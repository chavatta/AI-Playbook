#!/bin/bash
# Stop — quality gate do Reviewer.
# Antes de encerrar a sessão, verifica se alguma task foi marcada como `done`
# no run-log sem artifacts/reviewer.md contendo aprovação explícita.
# exit 2 = impede o encerramento e devolve a pendência ao agente.

input=$(cat)

# anti-loop: se a sessão já está continuando por causa deste hook, não bloquear de novo
if command -v jq >/dev/null 2>&1; then
  active=$(echo "$input" | jq -r '.stop_hook_active // false')
else
  echo "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && active=true || active=false
fi
[ "$active" = "true" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-.}"
[ -d "$root/tasks" ] || exit 0

for d in "$root"/tasks/*/; do
  base=$(basename "$d")
  [ "$base" = "_TEMPLATE" ] && continue
  log="$d/run-log.md"
  [ -f "$log" ] || continue
  # task marcada como done no run-log (coluna event ou status)
  if grep -qiE '\|[[:space:]]*done[[:space:]]*\|' "$log"; then
    rev="$d/artifacts/reviewer.md"
    if [ ! -f "$rev" ] || ! grep -qiE 'APROVADO|APPROVED' "$rev"; then
      echo "GATE VIOLADO: a task '$base' está marcada como done sem aprovação explícita do Reviewer em artifacts/reviewer.md. Rode o reviewer (ou corrija o run-log) antes de encerrar — GOVERNANCE.md §3." >&2
      exit 2
    fi
  fi
done

exit 0
