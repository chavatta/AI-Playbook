# ADR-002 — Agente Security-SRE (escopo e modelo)

**Status:** Aceito
**Data:** 2026-07-31
**Decisores:** Tech Lead
**Revisão:** semestral
**Última revisão:** 2026-09-23
**Relacionado:** complementa ADR-001 (modelos por agente) — não o supersede.

## Contexto

A revisão de escopo dos 9 agentes mostrou que a responsabilidade de segurança estava **diluída em três agentes sem dono sistêmico**: o Reviewer cobre OWASP no diff, o Coder evita secrets no código, o DevOps cita scanning e least privilege como domínio. Ninguém era dono de: threat modeling, auditoria de supply chain, segurança do pipeline (4 camadas DevSecOps), postura de runtime e prontidão de produção (SLOs, incident readiness).

O `multi-agents/ARCHITECTURE.md` (atualização 2026-06-29) já previa o agente **Security-SRE** (nº 12), mas o manual e a definição operacional nunca foram criados. Os agentes 09–11 (Spec-Writer, Data-Engineer, AI-Engineer) previstos na mesma atualização permanecem como backlog. *[Superado — ADR-003]*

## Decisão

1. Criar o agente **Security-SRE** com escopo de auditoria sistêmica de segurança + prontidão de produção, conforme `multi-agents/agents/12-security-sre.md`, com método em `praticas/06-devsecops.md`.
2. **Fronteira com o Reviewer:** Reviewer = segurança **do diff** (OWASP no código mudado, gate universal). Security-SRE = segurança **do sistema** (threat model, supply chain, pipeline, runtime, SRE), acionado por sensibilidade.
3. **Fronteira com o DevOps:** DevOps **implementa** os controles (scanners no CI, secret manager, policies); Security-SRE **especifica e audita**. Auditor não implementa o que audita.
4. **Gatilho de ativação:** features que tocam auth, dados pessoais, dinheiro ou superfície externa; toda task de infra/pipeline; sistemas com IA. Fora disso, o gate do Reviewer basta — Security-SRE em toda task trivial seria agent spam.
5. **Modelo: Fable — desde 2026-09-23 fixado em Fable 5.1 (`claude-fable-5-1`), enquanto os demais agentes de topo passaram a Opus 5.5; ver ADR-001 → "Revisão de 2026-09-23". Desde 2026-10-23 (ADR-010): alias `fable` com piso Fable 5.1, e Opus no Pro e em assento standard, onde o Fable sai em crédito avulso.** Mesmo racional do Reviewer no ADR-001 — é um gate; um falso "APROVADO" de segurança é o erro mais caro do fluxo (vulnerabilidade em produção). O custo extra é limitado porque o agente só entra em tasks sensíveis.

## Alternativas consideradas

1. **Expandir o Reviewer** — sobrecarregaria o gate universal com auditoria sistêmica em toda task, e mistura dois vereditos com critérios distintos.
2. **Deixar no DevOps** — conflito de interesse (implementaria e auditaria os próprios controles) e o DevOps rodava em Sonnet, insuficiente para um gate (desde 2026-09-23 roda em Opus 5.5, mas o conflito de interesse continua).
3. **Security-SRE em Sonnet** — gate menos capaz que o código que audita é gate decorativo (mesmo argumento do ADR-001 contra "tudo Sonnet").

## Consequências

**Positivas:** segurança com dono único e acionável; DevSecOps com método documentado; carga sobre a cota controlada pelo gatilho de sensibilidade.

**Negativas / mitigação:**
- Mais um handoff em features sensíveis → o gatilho restringe aos casos onde o custo se paga.
- Sobreposição percebida com o Reviewer → fronteira explícita registrada nos dois manuais.
- `GOVERNANCE.md §1` e contagens "8 especialistas" nos docs precisam refletir 9 especialistas (mudança de governança — Tech Lead). *[Superado: com o ADR-003, o quadro atual é de 12 especialistas + orchestrator, já refletido nos docs.]*
