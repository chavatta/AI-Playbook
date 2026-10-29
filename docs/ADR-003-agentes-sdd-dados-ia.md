# ADR-003 — Agentes Spec-Writer, Data-Engineer e AI-Engineer (escopo e modelo)

**Status:** Aceito
**Data:** 2026-07-31
**Última revisão:** 2026-09-23
**Decisores:** Tech Lead
**Revisão:** semestral
**Relacionado:** completa o quadro de 13 agentes previsto em `multi-agents/ARCHITECTURE.md` (atualização 2026-06-29); complementa ADR-001 (modelos) e ADR-002 (Security-SRE) — não os supersede.

## Contexto

O `ARCHITECTURE.md` previa 13 agentes (0–12) desde junho, mas três nunca foram criados: **Spec-Writer** (09), **Data-Engineer** (10) e **AI-Engineer** (11). Os fluxos 5 (SDD) e 6 (sistemas com IA) referenciavam agentes inexistentes, e a lacuna gerava confusão de contagem entre a doutrina e os arquivos reais.

## Decisão

1. Criar os três agentes previstos, com manual em `multi-agents/agents/` e definição operacional em `.claude/agents/`:
   - **Spec-Writer** — spec formal e verificável antes de arquitetura e código (SDD): critérios Given/When/Then, contratos OpenAPI, edge cases, NFRs mensuráveis, out-of-scope. Fronteira: não decide tecnologia (Architect) nem fatia tasks (Planner).
   - **Data-Engineer** — camada de dados: schema Postgres, migrations expand-contract com rollback, RLS default-deny provada por teste, índices justificados, pgvector. Fronteira: não escreve código de aplicação (Coder) nem provisiona infra (DevOps); destrutivo só com aprovação do Tech Lead.
   - **AI-Engineer** — subsistemas LLM: RAG, agentes/tools, prompts versionados, evals com golden set, guardrails. Fronteira: padrão mínimo primeiro; segurança (injeção/vazamento) auditada pelo Security-SRE; camada vetorial com o Data-Engineer.
2. **Gatilhos de ativação:** Spec-Writer no início de feature não-trivial (fluxo SDD); Data-Engineer quando a camada de dados é o foco; AI-Engineer quando há subsistema de IA. Nenhum entra em task que não os exige.
3. **Modelo: `sonnet` para os três** — *superado em 2026-09-23: os três passaram a Opus 5.5 (`claude-opus-5-5`), ver ADR-001 → "Revisão de 2026-09-23". Desde 2026-10-23 (ADR-010), os três declaram a família `opus` com piso Opus 5.5 e esforço `high`. O racional original fica abaixo como registro.* Pelo racional do ADR-001, o modelo de topo (Fable até 2026-09-23; desde então Opus 5.5, e Fable 5.1 no Security-SRE) fica nos nós cujo erro escapa sem gate: decomposição (Orchestrator), design (Architect) e os gates (Reviewer, Security-SRE). Os três novos agentes produzem trabalho **consumido e auditado por um nó no modelo de topo imediatamente a jusante**: a spec é validada pelo Architect-opus, e schema/subsistema de IA passam pelo Reviewer-opus (e Security-SRE-fable quando sensível). O Orchestrator pode sobrescrever o modelo na delegação em tasks épicas, como já previsto no ADR-001.

## Alternativas consideradas

1. **Spec-Writer no modelo de topo** — a spec é nó de alavancagem, mas tem gate imediato (Architect-opus lê a spec inteira antes de projetar); o ganho não justifica o consumo de cota em todo início de feature. *(Rejeitada em 2026-07-31; adotada em 2026-09-23 junto com os demais executores, ver ADR-001.)*
2. **Não criar e enxugar o ARCHITECTURE para 10 agentes** — removeria os fluxos 5 e 6; rejeitada porque SDD, camada de dados e sistemas com IA fazem parte do roadmap da equipe.
3. **Fundir Data-Engineer no Coder e AI-Engineer no Architect** — mantém a contagem menor, mas mistura responsabilidades com custos de erro muito distintos (migration destrutiva ≠ código de app; evals ≠ design de sistema).

## Consequências

**Positivas:** doutrina e arquivos consistentes (13 agentes: 1 orchestrator + 12 especialistas); fluxos 5 e 6 executáveis; camada de dados e IA com donos e regras invioláveis próprias.

**Negativas / mitigação:**
- Mais agentes para manter → todos seguem o mesmo template de manual; revisão junto com o ADR-001 (trimestral).
- Risco de agent spam → gatilhos de ativação explícitos; o fluxo enxuto (`Plan → Coder → Reviewer`) continua sendo o default.
- Contagens nos docs mudam de novo (9 → 12 especialistas) → atualizadas nesta mesma mudança.
