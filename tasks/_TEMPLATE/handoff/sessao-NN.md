# Handoff — {task_id} · sessão NN

<!-- Grave como tasks/{task_id}/handoff/sessao-NN.md (NN = 01, 02, …) ao trocar de sessão (docs/ADR-009, Frente 4).
Regras: só ponteiros e resumo — nunca cole conteúdo de artifact. Máximo: sessao_orquestrador.handoff_max_linhas
(praticas/00, default 120 ≈ 2 páginas). Só grave com NENHUM agente rodando: todos da onda já devolveram o ponteiro.
Escritor único: o Orchestrator (a sessão principal). Append-only no sentido de sessão: não reescreva handoff anterior. -->

**Sessão:** NN · **Encerrada em:** AAAA-MM-DD HH:MM · **Motivo:** onda {n} fechada | contexto acima de {limiar} tokens
**Handoff anterior:** `handoff/sessao-{NN-1}.md` | nenhum

## Estado das fatias

| Fatia / task | Status | Último artefato | Observação (1 linha) |
|---|---|---|---|
| {task_id da fatia} | done \| em andamento \| blocked \| escalado \| checkpoint | `artifacts/{agente}.md` | {…} |

## Decisões desta sessão

- {decisão em uma linha} — `decisions.md` §{…} | `docs/ADR-{…}` | `artifacts/{…}`

## Pendências e bloqueios

- {o que trava, quem destrava}

## Próxima ação exata

{Uma instrução executável: "abrir /task da fatia X", "delegar Coder da fatia Y com o checkpoint artifacts/coder-checkpoint-02.md", …}

## Leituras de cota (se houver)

- {uso da janela, limite de taxa observado, paralelismo reduzido para N}

## Para retomar

Em sessão nova na raiz do repo (`/clear` na mesma janela ou um terminal novo com `claude`):

```
/task retomar {task_id}
```

A sessão nova lê **este arquivo** e o `brief.md`, e abre artifact só sob demanda.
