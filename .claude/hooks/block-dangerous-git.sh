#!/bin/bash
# PreToolUse/Bash — bloqueia comandos git/shell destrutivos, inclusive sintaxes
# que burlam o deny por prefixo (ex.: git push origin HEAD:main).
# exit 2 = bloqueia a ação e devolve o stderr ao agente.

input=$(cat)
if command -v jq >/dev/null 2>&1; then
  cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
else
  # fallback sem jq: extrai o campo command de forma aproximada
  cmd=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
fi

norm=$(echo "$cmd" | tr -s ' ')

# push para main/master, em qualquer forma (origin main, HEAD:main, refs completas)
if echo "$norm" | grep -qE 'git +push +[^ ]+ +(HEAD:|refs/heads/)?(main|master)([^-a-zA-Z0-9_/]|$)'; then
  echo "BLOQUEADO: push direto em main/master. Fluxo correto: branch + draft PR (GOVERNANCE.md §2)." >&2
  exit 2
fi

# force push em qualquer ordem de flags, incluindo refspec com +
if echo "$norm" | grep -qE 'git +push( +[^ ]+)* +(--force|--force-with-lease|-f)([^-a-zA-Z]|$)'; then
  echo "BLOQUEADO: force push. Se for realmente necessário, é decisão do Tech Lead, não do agente." >&2
  exit 2
fi
if echo "$norm" | grep -qE 'git +push +[^ ]+ +\+[^ ]+'; then
  echo "BLOQUEADO: push com refspec forçado (+). Equivale a force push (GOVERNANCE.md §2)." >&2
  exit 2
fi

# rm -rf / -fr em qualquer combinação de flags
if echo "$norm" | grep -qE '(^|[;&|] *)rm +(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]* '; then
  echo "BLOQUEADO: rm -rf. Delete arquivos individualmente e explique o motivo no artifact." >&2
  exit 2
fi

# destruição de histórico/working tree
if echo "$norm" | grep -qE 'git +reset +--hard'; then
  echo "BLOQUEADO: git reset --hard descarta trabalho. Use stash ou branch (GOVERNANCE.md §2)." >&2
  exit 2
fi
if echo "$norm" | grep -qE 'git +clean +-[a-zA-Z]*f'; then
  echo "BLOQUEADO: git clean -f apaga arquivos não rastreados. Revise manualmente o que remover." >&2
  exit 2
fi

exit 0
