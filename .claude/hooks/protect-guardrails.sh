#!/bin/bash
# PreToolUse/Write|Edit — impede o agente de alterar as próprias travas e a governança.
# Cobre também caminhos absolutos, que o deny relativo do settings.json não pega.
# exit 2 = bloqueia.

input=$(cat)
if command -v jq >/dev/null 2>&1; then
  fp=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
else
  fp=$(echo "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
fi

case "$fp" in
  */.claude/settings.json|.claude/settings.json)
    echo "BLOQUEADO: '.claude/settings.json' contém as travas do playbook e não pode ser alterado por agentes. Mudanças aqui são do Tech Lead (GOVERNANCE.md §6)." >&2
    exit 2 ;;
  */.claude/hooks/*|.claude/hooks/*)
    echo "BLOQUEADO: hooks são as travas mecânicas do playbook e não podem ser alterados por agentes (GOVERNANCE.md §6)." >&2
    exit 2 ;;
  */GOVERNANCE.md|GOVERNANCE.md)
    echo "BLOQUEADO: GOVERNANCE.md é a lei do playbook — só o Tech Lead altera (GOVERNANCE.md §6)." >&2
    exit 2 ;;
esac

exit 0
