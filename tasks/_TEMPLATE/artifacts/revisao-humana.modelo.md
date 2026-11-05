**Veredito:** APROVADO | REPROVADO (n pontos)
**Revisor:** {nome} · AAAA-MM-DD

# Revisão humana — {task_id}

> Modelo de `docs/ADR-011` D1. Escritor: **o revisor**, ou a sessão transcrevendo o que ele disse na conversa. Agente nunca grava este veredito por conta própria.
> A primeira linha é lida pelo hook `check-reviewer-gate.mjs`: exatamente `**Veredito:** APROVADO` ou `**Veredito:** REPROVADO (n pontos)`. Não use a palavra APROVADO em outro trecho.

## O que foi revisado

- PR: {link}
- Arquivos: {files_changed dos artifacts do Coder}

## Pontos

{Se REPROVADO: um ponto por linha, com arquivo e o que mudar. Se APROVADO: observações, ou "sem observações".}
