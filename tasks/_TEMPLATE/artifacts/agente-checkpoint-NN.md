# Checkpoint — {agente} · {task_id} · NN

<!-- Grave como tasks/{task_id}/artifacts/{agente}-checkpoint-NN.md ao atingir o limiar de orçamento
(docs/ADR-009, Frente 5) e devolva o ponteiro com status: checkpoint e artifact_path apontando para cá.
Só em estado consistente: código compilando, ou mudança pequena isolada e anotada abaixo.
Reviewer e Security-SRE não usam checkpoint. O gate exige o artifact FINAL do agente, nunca este. -->

**Motivo:** {n} tool calls (limite {l}, faixa {faixa}) | contexto ~{n} tokens (limite {l})
**Checkpoint anterior:** `artifacts/{agente}-checkpoint-{NN-1}.md` | nenhum
**Estado do código:** compila e testes passam | compila, testes pendentes | mudança parcial isolada em {arquivo} (ver Armadilhas)

## Feito

- {item concluído, com o critério de aceitação que ele atende}

## Arquivos tocados

- `{caminho}` — {o que mudou, uma linha}

## Falta

- {próximo passo, na ordem}

## Testes pendentes

- {teste ou comando quiet a rodar, e o que se espera}

## Decisões e armadilhas

- {decisão tomada e por quê; armadilha encontrada e como evitar}

## Leituras já resumidas

<!-- O agente seguinte não relê o que está aqui, a menos que precise do trecho exato. -->
- `{arquivo}:{faixa}` — {o que interessa dele, em uma linha}
