#!/usr/bin/env bash
# Falha o job se houver padrão de PII brasileiro em dado de teste.
# Somatório ao gitleaks, não alternativa: um procura segredo, o outro dado pessoal.
# Método e limites: praticas/06-devsecops.md → "Check de PII em dado de teste".
#
# Saída: 0 = limpo (inclusive quando não há pasta de dado de teste) · 1 = achou.
set -u

# Cada forma só casa delimitada por não-dígito: sem isso o celular cru (11 dígitos com 9
# na terceira posição) casava dentro de timestamp em ms, ID longo e hash numérico.
PADRAO='(^|[^0-9])([0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}|\(?[0-9]{2}\)? ?9[0-9]{4}-?[0-9]{4})([^0-9]|$)'

# Poda .git, node_modules e afins antes de casar os alvos — varrer isso gera
# falso positivo (spec de dependência de terceiro) e custo à toa. -I ignora
# binário. -exec ... {} + é seguro: não passa o nome do arquivo por um shell.
achados=$(find . \
  \( -name .git -o -name node_modules -o -name vendor -o -name dist -o -name build \) -prune -o \
  -type f \
  \( -path '*/fixtures/*' -o -path '*/seeds/*' -o -path '*/factories/*' \
     -o -path '*/testdata/*' -o -path '*/__fixtures__/*' \
     -o -name '*.seed.*' -o -name '*.test.*' -o -name '*.spec.*' \) \
  -exec grep -IEnH "$PADRAO" {} + 2>/dev/null)

if [ -n "$achados" ]; then
  echo "$achados"
  echo
  echo "PII em dado de teste. Use fixture sintética gerada por seed (praticas/06-devsecops.md)."
  echo "Se for falso positivo, ajuste o padrão neste script — não desligue o check."
  exit 1
fi

exit 0
