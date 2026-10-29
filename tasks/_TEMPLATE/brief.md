# Brief — {task_id}

**Criado por:** Orchestrator
**Data:** AAAA-MM-DD
**Complexidade:** trivial | simples | média | complexa | épica
**Sensível (security gate):** sim | não — toca auth, dados pessoais, dinheiro, superfície externa ou infra? Se sim, `security-sre` entra no fluxo e `artifacts/security-sre.md` APROVADO é obrigatório antes de `done`
**Classe de dado:** Pública | Interna | Confidencial | Restrita — classifique pelo dado mais sensível que a task toca (`praticas/10-dados-e-contexto-de-ia.md` §2). Confidencial ou Restrita ⇒ a task é sensível.
**Avaliação de impacto de IA:** sim | não — obrigatória se a feature entrega decisão/conteúdo de IA a usuário final, processa dado pessoal com IA, ou influencia decisão sobre pessoas. Se sim, `artifacts/impacto-ia.md` (`multi-agents/templates/AVALIACAO-IMPACTO-IA.template.md`) é obrigatório antes de `done`
**Fluxo escolhido:** `playbook-task (workflow)` via `/task` — ou o fluxo manual, se o Workflow estiver indisponível (registre no run-log)
**Recon:** `artifacts/recon.md` — preenchido pelo script; a Complexidade acima é substituída pela dele, e Sensível pode ser elevado por ele

## Objetivo (verificável)
{Uma frase: o que estará verdadeiro quando a task estiver pronta.}

## Escopo
- Dentro: {...}
- Fora: {...}

## Critérios de sucesso / aceitação
- [ ] {critério 1}
- [ ] {critério 2}

## Contexto e constraints
{Decisões anteriores, stack, restrições de GOVERNANCE, repo GitHub, etc.}

## Agentes previstos
{ex: planner, coder, reviewer}
