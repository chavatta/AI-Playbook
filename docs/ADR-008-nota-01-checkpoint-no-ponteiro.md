# ADR-008, nota 01 — Checkpoint no ponteiro do evento `handoff.pointer`

**Status:** Proposto
**Data:** 2026-10-13
**Decisores:** Tech Lead
**Relacionado:** complementa o ADR-008 (§2, mudança aditiva na v1) e acompanha o ADR-009 (o `status: checkpoint` do ponteiro, `HANDOFF-PROTOCOL` §3.2). Não muda o `POINTER` do `playbook-task.js` nem o envelope do evento.

## Contexto

O ADR-009 acrescentou `checkpoint` ao enum do ponteiro: o agente que chega ao limiar de contexto grava `{agente}-checkpoint-NN.md` e devolve `status: checkpoint`, e o script delega um agente novo do mesmo papel. O evento `handoff.pointer` da v1, porém, leva o `status` com os 3 valores do protocolo anterior (`completed`, `blocked`, `needs_review`), num enum fechado. Acrescentar `checkpoint` a esse enum exigiria a v2 (ADR-008 §2).

Sem nada no evento, o checkpoint fica invisível ou vira ponteiro inválido: um emissor que filtra o `status` pelos 3 valores marca o ponteiro como `invalid_status`, e o consumidor só reconhece o checkpoint se reler o ponteiro bruto (`raw`, que não sai no detalhe `minimal`).

## Decisão

1. **Campo novo, opcional, em `data` do `handoff.pointer`:** `checkpoint`, booleano fixo em `true` (`{"type": "boolean", "const": true}`). É o caso de campo opcional em `data` do ADR-008 §2, sem exceção: fica na v1.
2. **Regra do emissor:** ponteiro com `status: checkpoint` e `artifact_path` com conteúdo sai com `checkpoint: true` e **sem** `status`, e é válido. Os outros 3 status saem como hoje, sem `checkpoint`. Checkpoint sem `artifact_path` (vazio ou só espaços) é ponteiro inválido (`checkpoint_requires_artifact_path`), sem `status` e sem `checkpoint`.
3. **Regra do consumidor:** `checkpoint: true` sem `status` é um ponteiro de checkpoint. Se um emissor mandar os dois, vale o `status`. O schema não impõe a exclusão mútua, para a mudança continuar só aditiva.
4. **O enum do `status` não muda:** segue com os 3 valores. O barramento (`bus.handoff`, em `data.pointer`) herda o campo pelo mesmo bloco de campos do ponteiro, mas não produz checkpoint: checkpoint é continuação do mesmo papel, não passagem a outro.
5. **Emissor:** a versão 0.2.0 de `docs/patches/telemetry-emit.mjs` aplica a regra 2, com caso novo na suíte. Aplicar em `.claude/hooks/` segue o `docs/patches/README.md` (zona protegida, Tech Lead).

## Compatibilidade

| | Consumidor antigo | Consumidor novo |
|---|---|---|
| **Emissor antigo** | Como hoje: o checkpoint chega como ponteiro `invalid_status` | Com o `raw` (detalhe `standard` ou `verbose`), relê o ponteiro e reconhece o checkpoint; no `minimal`, sem `raw`, segue como ponteiro inválido |
| **Emissor novo** | Preserva `checkpoint` (o `data` é tolerante) e o ignora; vê um ponteiro válido sem `status` | Reconhece o checkpoint direto pelo campo, sem depender do `raw` |

**Limite aceito:** emissor antigo no detalhe `minimal` não manda o `raw`, e o checkpoint dele não é recuperável. A correção é atualizar o emissor.

## Alternativas consideradas

- **`checkpoint` no enum do `status`:** valor novo em enum fechado, exige v2 e cópia congelada da v1. Custo desproporcional para um valor.
- **Nada no evento, o fato só no `run.state` com `reason: checkpoint`:** funciona só para execução lançada pelo orquestrador; uma sessão observada pelo hook não emite `run.state`, e o checkpoint dela se perde.

## Consequências

- O `evento.schema.json` muda (8 linhas: o campo no `data` do `handoff.pointer` e no bloco comum de ponteiro que o `bus.handoff` usa em `data.pointer`) e a cópia é conferida por `sha256` com o gerador, como sempre.
- Ficam dois campos para um fato (`status` e `checkpoint`). É o custo de ficar na v1; a regra de precedência resolve o caso de os dois virem juntos.

## Revisão

Junto com a próxima major do contrato: na v2, `checkpoint` entra no enum do `status` e este campo é removido.
