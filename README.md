# AI Playbook

Padrão de desenvolvimento com IA da equipe: **time de agentes especializados + gates de qualidade + travas mecânicas de segurança**.

> **Dono:** Tech Lead · **Revisão:** semestral · **Última revisão:** 2026-09-23

## Comece por aqui

1. **[DESENVOLVIMENTO-COM-IA.md](DESENVOLVIMENTO-COM-IA.md)** — por que trabalhamos assim: riscos de dev com IA e como cada um é mitigado. *Leitura nº 1.*
2. **[ONBOARDING.md](ONBOARDING.md)** — setup e como trabalhar no dia a dia.
3. **[GOVERNANCE.md](GOVERNANCE.md)** — a lei: papéis, regras de git, gates e travas.
4. **[docs/ISO-MAPPING.md](docs/ISO-MAPPING.md)** — como o playbook se enquadra na ISO/IEC 27001 e 42001. *Para auditor, cliente e RFP.*

## O que tem aqui

```
AI-Playbook/
├── DESENVOLVIMENTO-COM-IA.md      # Riscos, cuidados e boas práticas (leia primeiro)
├── ONBOARDING.md                  # Guia de entrada do analista
├── GOVERNANCE.md                  # Regras (papéis, git, gates, travas)
├── .claude/
│   ├── agents/                    # 13 agentes (orchestrator + 12 especialistas), com modelo por papel
│   ├── hooks/                     # Travas mecânicas em Node/.mjs — multiplataforma (push em main, guardrails, reviewer gate)
│   ├── workflows/                 # playbook-task.js — o fluxo de desenvolvimento como script (ADR-005)
│   ├── skills/                    # /task — abre uma task e dispara o fluxo
│   └── settings.json              # Permissions deny + registro dos hooks
├── multi-agents/
│   ├── ARCHITECTURE.md            # Doutrina: topologia, fluxos, anti-padrões
│   ├── HANDOFF-PROTOCOL.md        # Como os agentes trocam trabalho (artifacts em disco)
│   ├── SKILLS-GOVERNANCE.md       # Reuso e criação de skills (regra dos 3)
│   ├── agents/                    # Manual completo de cada agente (00–12)
│   └── templates/                 # SKILL.template.md, AVALIACAO-IMPACTO-IA.template.md
├── praticas/                      # Biblioteca de boas práticas (stack do projeto, clean code, clean architecture,
│                                  #   design funcional, modularização, monorepo, containers, EKS, DevSecOps+LGPD, testes,
│                                  #   dados e contexto de IA, MCP, disciplina de saída de ferramenta)
├── scripts/
│   ├── check-pii.sh               # Padrão de PII (CPF, CNPJ, celular) em fixtures/seeds — no CI, ao lado do gitleaks
│   ├── test-playbook-task.mjs         # Smoke test do fluxo por script, com agentes simulados — sem gastar quota
│   ├── smoke-harness.mjs          # Prova no CLI real os mecanismos de hook/background do ADR-009 (gasta centavos)
│   ├── quiet/                     # test-quiet, lint-quiet, analise-quiet: só falhas e resumo (praticas/12)
│   └── telemetria/                # Relatório de custos: custo por tipo em dólar, razão de cache, cache quebrado
├── docs/
│   ├── ADR-001-modelos-por-agente.md … ADR-010-familias-e-esforco-por-agente.md
│   ├── ISO-MAPPING.md             # Rastreabilidade ISO 27001 / ISO 42001 → evidência → status
│   ├── EVIDENCIAS-E-METRICAS.md   # Retenção de evidência, métricas do playbook, cadência de revisão
│   ├── COMPETENCIA.md             # Registro de quem leu o onboarding e quando (ISO 42001 A.4.6)
│   ├── RUNBOOK-INCIDENTE-IA.md    # Vazamento via prompt, código defeituoso em prod, dependência alucinada
│   └── patches/                   # Versões propostas de arquivos protegidos — só o Tech Lead aplica
└── tasks/
    └── _TEMPLATE/                 # brief.md, run-log.md, memory.md, decisions.md, artifacts/, handoff/
                                   #   + modelos de checkpoint de agente e de handoff de sessão (ADR-009)
```

## Adotando em um repositório

Copie para a raiz do repo:

```bash
cp -R AI-Playbook/.claude AI-Playbook/multi-agents AI-Playbook/praticas AI-Playbook/scripts <repo>/
mkdir -p <repo>/tasks && cp -R AI-Playbook/tasks/_TEMPLATE <repo>/tasks/
cp -R AI-Playbook/docs <repo>/
cp AI-Playbook/{README.md,DESENVOLVIMENTO-COM-IA.md,ONBOARDING.md,GOVERNANCE.md} <repo>/
printf '%s\n' '' '# Spool da telemetria do playbook (docs/ADR-008)' 'tasks/*/telemetry.jsonl*' '.claude/telemetry-spool.jsonl*' '.claude/context-budget.jsonl' >> <repo>/.gitignore
```

No Windows (PowerShell), o equivalente (`tasks\_TEMPLATE` exige criar `<repo>\tasks` antes):

```powershell
Copy-Item -Recurse AI-Playbook\.claude,AI-Playbook\multi-agents,AI-Playbook\praticas,AI-Playbook\scripts,AI-Playbook\docs <repo>\
New-Item -ItemType Directory -Force <repo>\tasks | Out-Null
Copy-Item -Recurse AI-Playbook\tasks\_TEMPLATE <repo>\tasks\
Copy-Item AI-Playbook\README.md,AI-Playbook\DESENVOLVIMENTO-COM-IA.md,AI-Playbook\ONBOARDING.md,AI-Playbook\GOVERNANCE.md <repo>\
Add-Content <repo>\.gitignore '', '# Spool da telemetria do playbook (docs/ADR-008)', 'tasks/*/telemetry.jsonl*', '.claude/telemetry-spool.jsonl*', '.claude/context-budget.jsonl'
```

Copia-se `tasks/_TEMPLATE/`, não as tasks deste próprio playbook. A última linha de cada bloco acrescenta ao `.gitignore` do repo os padrões do spool da telemetria ([`docs/telemetria/`](docs/telemetria/README.md)): é fila de envio, não evidência, e são os únicos arquivos de `tasks/` fora do git. No repo adotante, apague `docs/patches/` — são propostas de mudança nas travas *deste* playbook, não do projeto novo — e `docs/COMPETENCIA.md`, que fica só no repo do playbook (registro organizacional, não por projeto).

Depois de copiar, preencha no `praticas/00` o bloco **Orçamento de contexto e execução**: pelo menos `comandos_quiet` (os comandos de teste, lint e análise estática do projeto, que os wrappers `scripts/quiet/*-quiet.mjs` rodam mostrando só falhas e resumo). Os limiares já vêm com default; ajuste por projeto e cite o ADR (`docs/ADR-009`).

Os hooks são scripts Node (`.mjs`) — funcionam automaticamente em macOS, Linux e Windows, sem `chmod` nem configuração por sistema.

Depois abra o Claude Code na raiz do repo — agentes, gates e travas carregam automaticamente.

## Requisitos

- [Claude Code](https://claude.com/claude-code), plano pago com acesso a Opus, Sonnet e Haiku. O Fable (Security-SRE) entra no plano Max e em assento premium; no Pro, o Security-SRE roda em Opus. Declare o plano da máquina com `node scripts/plano-assinatura.mjs` (`docs/ADR-010`)
- [Node.js](https://nodejs.org) ≥ 18 (runtime dos hooks — multiplataforma)
- Git + GitHub CLI (`gh`)

Funciona em macOS, Linux e Windows sem configuração por sistema — os hooks são Node e o `settings.json` os invoca do mesmo jeito nos três.
