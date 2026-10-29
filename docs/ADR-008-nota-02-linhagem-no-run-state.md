# ADR-008, nota 02 — Linhagem da run declarada no `run.state`

**Status:** Proposto
**Data:** 2026-10-18
**Decisores:** Tech Lead
**Relacionado:** complementa o ADR-008 (§2, mudança aditiva na v1) e a nota 01 (checkpoint). Não muda o envelope do evento nem o `POINTER` do `playbook-task.js`.

## Contexto

O orquestrador emite `run.state` com a linhagem da run: `retry_of_run_id` (nova tentativa), `resumed_from_run_id` (retomada na mesma sessão) e `continues_run_id` (continuação de checkpoint do ADR-009, agente novo do mesmo papel). Os três já circulavam no `data` tolerante do `run.state`, mas o schema não os declarava. Sem a declaração, um validador aceita qualquer valor nesses campos e o consumidor precisa conferir o formato sozinho.

## Decisão

1. **Três campos opcionais em `data` do `run.state`:** `retry_of_run_id`, `resumed_from_run_id` e `continues_run_id`, todos string no formato de run id (`^run_[0-9A-HJKMNP-TV-Z]{26}$`). É o caso de campo opcional em `data` do ADR-008 §2: fica na v1.
2. **Regra do consumidor:** a linhagem não tem chave estrangeira, mas o formato é contrato. O validador recusa o evento inteiro quando um dos três campos está presente fora do formato (outro tipo, `null` ou padrão errado): é o que faz qualquer validador JSON Schema 2020-12 com o `pattern` do item 1. O consumidor que projeta eventos sem revalidá-los (replay de evento gravado antes desta nota) descarta o valor fora do formato e registra anomalia.

## Compatibilidade

| | Consumidor antigo | Consumidor novo |
|---|---|---|
| **Emissor antigo** | Como hoje | Como hoje: os emissores existentes já mandam run id no formato |
| **Emissor novo** | Preserva os campos (o `data` é tolerante) | Valida o formato pelo schema: linhagem fora do formato recusa o evento inteiro |

## Consequências

- O `evento.schema.json` muda (12 linhas no `data` do `run.state`) e a cópia é conferida por `sha256` com o gerador, como sempre.
- O emissor do hook (`docs/patches/telemetry-emit.mjs`) não muda: ele não emite `run.state`.
