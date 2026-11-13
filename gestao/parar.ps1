# Para o portal de gestão (Windows). Idempotente. Uso: powershell -File gestao/parar.ps1
node (Join-Path $PSScriptRoot "painel.mjs") parar
