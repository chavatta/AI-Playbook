# Sobe o portal de gestão em segundo plano (Windows). Idempotente. Uso: powershell -File gestao/iniciar.ps1
# Porta: variável GESTAO_PORT (padrão 4317). A lógica está em gestao/painel.mjs (igual em todos os sistemas).
node (Join-Path $PSScriptRoot "painel.mjs") iniciar
