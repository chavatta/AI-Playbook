# Multi-Agent Architecture for Software Development

> Based on research from Anthropic Engineering, AgentForge, AgentMesh, and academic literature on LLM-based multi-agent systems (2025–2026).
>
> **Dono:** Tech Lead · **Revisão:** semestral · **Última revisão:** 2026-09-23

---

## Princípios Fundamentais

### Por que Multi-Agents?

Agentes únicos têm limites: contexto limitado, raciocínio sequencial, e tendência a "misturar" responsabilidades. Um sistema multi-agent resolve isso através de:

- **Paralelismo real** — agentes trabalhando simultaneamente em subtarefas independentes
- **Especialização profunda** — cada agente tem um único domínio de excelência
- **Separação de concerns** — menos chance de um agente contaminar o raciocínio de outro
- **Escalabilidade** — adicionar capacidade = adicionar agentes

> Dado da Anthropic: um sistema multi-agent com um modelo de topo como lead e Sonnet como subagentes superou um sistema single-agent em **90.2%** em tarefas de pesquisa complexas. (O estudo original usou Opus como lead e Sonnet nos subagentes. Desde 2026-09-23, o playbook roda lead e quase todos os subagentes em **Opus 5.5** — ver `ADR-001`.)

---

## Topologia: Orchestrator-Worker Hierárquico

```
                         ┌─────────────────────┐
                         │    ORCHESTRATOR      │
                         │  (Lead Agent)        │
                         │  decompõe · delega   │
                         │  coordena · sintetiza│
                         └──────────┬──────────┘
                                    │
   ┌──────────────┬─────────────────┼─────────────────┬──────────────┐
   │              │                 │                 │              │
┌──▼────────┐ ┌──▼────────┐  ┌──────▼─────┐  ┌────────▼────┐ ┌──────▼──────┐
│SPEC-WRITER│ │ ARCHITECT │  │   PLANNER  │  │    CODER     │ │   DEVOPS    │
│ (spec SDD)│ │ (design)  │  │  (tasks)   │  │   (impl.)    │ │  (infra)    │
└───────────┘ └───────────┘  └────────────┘  └──────┬──────┘ └─────────────┘
                                                     │
   ┌──────────────┬─────────────────┬────────────────┼─────────────────┐
   │              │                 │                │                 │
┌──▼────────┐ ┌──▼────────┐  ┌──────▼─────┐  ┌────────▼────┐ ┌─────────▼────┐
│   DATA    │ │    AI     │  │  REVIEWER  │  │   TESTER     │ │   DEBUGGER   │
│ ENGINEER  │ │ ENGINEER  │  │ (quality)  │  │ (test+evals) │ │ (fix bugs)   │
│(db/RLS/vec│ │(RAG/agents│  └─────┬──────┘  └──────────────┘ └──────────────┘
└───────────┘ └───────────┘        │
                         ┌─────────┼──────────┐
                         │                    │
                  ┌──────▼──────┐      ┌──────▼──────┐
                  │ SECURITY-SRE│      │ DOCUMENTER  │
                  │(sec+SLO/SRE)│      │   (docs)    │
                  └─────────────┘      └─────────────┘
```

---

## Os 13 Agentes (1 Orchestrator + 12 Especialistas)

> **Atualizado em 2026-06-29** com base no estudo `03-TECHNOLOGY/Stacks-Arquiteturas-Estado-Da-Arte-2026.md` (vault externo, fora deste repo). Os 8 originais foram revisados e ancorados nos defaults de stack 2026; 4 novos (Spec-Writer, Data-Engineer, AI-Engineer, Security-SRE) cobrem as lacunas que o estudo revelou (SDD, camada de dados, sistemas de IA/RAG, segurança aprofundada + SRE).

| # | Agente | Responsabilidade Principal | Quando Ativar |
|---|--------|--------------------------|---------------|
| 0 | **Orchestrator** | Decompor, delegar, sintetizar | Sempre — é o ponto de entrada |
| 1 | **Architect** | Design de sistema, tech decisions | Nova feature, refactor, decisão técnica |
| 2 | **Planner** | Transformar design em tarefas concretas | Após Architect/Spec, antes de Coder |
| 3 | **Coder** | Implementação do código | Após Planner ter specs prontas |
| 4 | **Reviewer** | Review de código, qualidade, arquitetura | Após Coder terminar implementação |
| 5 | **Tester** | Escrever e executar testes (+ evals de IA) | Em paralelo ou após Coder/AI-Engineer |
| 6 | **Debugger** | Diagnóstico e correção de bugs | Quando testes falham ou há bug reportado |
| 7 | **Documenter** | Docs técnicos, READMEs, API docs | Após feature estar aprovada |
| 8 | **DevOps** | CI/CD, deploy, infraestrutura | Para tasks de infra, deploy, pipeline |
| 9 | **Spec-Writer** 🆕 | Spec formal ANTES do código (SDD) | Primeiro passo de feature não-trivial |
| 10 | **Data-Engineer** 🆕 | Schema Postgres, migrations, RLS, pgvector, CDC | Quando a camada de dados é o foco |
| 11 | **AI-Engineer** 🆕 | RAG, agentes, prompts, evals, guardrails | Sistemas com IA/agentes |
| 12 | **Security-SRE** 🆕 | OWASP, supply chain, SLOs, incident | Features sensíveis; confiabilidade de prod |

### Ordenação lógica no ciclo SDD

Embora numerados por ordem de criação, o **fluxo natural de 2026** posiciona o Spec-Writer antes do Architect:

```
spec-writer → architect → (data-engineer | ai-engineer) → planner → coder (+ tester) → reviewer → security-sre → debugger → documenter → devops
```

---

## Fluxos de Trabalho

### Fluxo 1: Nova Feature

```
User → Orchestrator
  → Architect (design & decisões técnicas)
    → Planner (quebra em tasks)
      → Coder (implementa)
      → Tester (em paralelo: escreve testes)
        → Reviewer (review do código)
          → Debugger (se necessário)
            → Documenter (documenta)
              → Orchestrator (sintetiza & entrega)
```

### Fluxo 2: Bug Fix

```
User → Orchestrator
  → Debugger (diagnóstico & root cause)
    → Coder (correção)
      → Tester (valida correção)
        → Reviewer (review)
          → Orchestrator (entrega)
```

### Fluxo 3: Refactor

```
User → Orchestrator
  → Architect (avalia estado atual, propõe estratégia)
    → Planner (plano de refactor em etapas)
      → Coder + Reviewer (em ciclos)
        → Tester (garante que nada quebrou)
          → Documenter (atualiza docs)
            → Orchestrator (entrega)
```

### Fluxo 4: Task Técnica / Infra

```
User → Orchestrator
  → DevOps (implementa pipeline/infra)
    → Security-SRE (least privilege, secrets, supply chain)
      → Reviewer (review da config)
        → Tester (smoke tests)
          → Orchestrator (entrega)
```

### Fluxo 5: Nova Feature com SDD (default 2026)

```
User → Orchestrator
  → Spec-Writer (spec formal: OpenAPI, critérios de aceitação)
    → Architect (decisões técnicas & ADR)
      → Data-Engineer (schema/RLS, se a feature tem dados)
        → Planner (quebra em tasks)
          → Coder (implementa) + Tester (em paralelo)
            → Reviewer (review)
              → Security-SRE (se toca auth/dados/superfície externa)
                → Documenter (docs derivadas da spec)
                  → Orchestrator (entrega)
```

### Fluxo 6: Sistema com IA / Agentes

```
User → Orchestrator
  → Spec-Writer (spec do comportamento + contratos)
    → Architect (topologia do subsistema de IA)
      → Data-Engineer (pgvector, schema de chunks)
      → AI-Engineer (RAG + guardrails, no padrão mínimo que atende — framework é decisão do Architect)
        → Tester (evals: faithfulness, golden set)
          → Reviewer + Security-SRE (injeção de prompt, vazamento)
            → Documenter
              → Orchestrator (entrega)
```

---

## Execução: o script `playbook-task` (ADR-005)

Os fluxos acima **explicam**; quem **decide** é `.claude/workflows/playbook-task.js`, executado pela ferramenta nativa Workflow e disparado pela skill `/task`. A prosa desta página é a documentação do script, não uma segunda fonte de verdade — se divergirem, o script está certo e esta página está desatualizada.

O que o script faz que a prosa não conseguia garantir:

| Propriedade | Como |
|---|---|
| Roteamento com informação | `recon` (Architect, modo levantamento, esforço baixo) roda **antes** de classificar; o `if` decide com escopo real |
| Teto do retrabalho | `for (round ≤ 2)`; na 2ª reprovação devolve `escalado` |
| Verificação proporcional ao risco | `if (sensitive)` → Reviewer ∥ Security-SRE ∥ Tester, unanimidade; senão voto único |
| Anti-carimbo | refutador cego após a aprovação em task sensível; discordância devolve `divergencia` |
| Gate por código | `done` só é retornado após veredito validado por schema; o hook `check-reviewer-gate.mjs` é a segunda linha |
| Épica | fatiada pelo Planner; cada fatia é uma `/task` |
| Ponteiro | o bloco YAML do §3.2 vira JSON Schema validado na chamada |

O script **não toca disco**: cada agente grava seu artifact em `tasks/{id}/artifacts/` por instrução, e a sessão principal anexa ao `run-log.md` os `events` que o script devolve (escritor único, `GOVERNANCE.md §4.3`). Restrições da ferramenta: sem `fs`, sem `Date`/`Math.random` (os `events` saem sem hora; a sessão principal carimba o timestamp ao anexar ao `run-log.md`), até 16 agentes simultâneos, plano pago com Dynamic workflows habilitados.

---

## Protocolo de Handoff

O contrato completo está em **`HANDOFF-PROTOCOL.md`** — ele é a fonte de verdade. Resumo: cada agente grava seu trabalho completo em `tasks/{task_id}/artifacts/{agente}.md` e devolve ao Orchestrator **apenas o ponteiro leve** (nunca o conteúdo bruto — isso causaria os anti-padrões *Context Bloat* e *Telephone Game* listados abaixo):

### Formato do ponteiro

```yaml
agent: coder
task_id: 2026-06-29_auth-jwt
status: completed        # completed | blocked | needs_review
artifact_path: tasks/2026-06-29_auth-jwt/artifacts/coder.md
files_changed: [src/auth/login.ts, src/auth/jwt.ts]
next_agent: reviewer
context_for_next: "JWT implementado. Revisar validação do token e rate limiting."
blockers: []
skill_candidates: []
```

### Princípios de Handoff

1. **Subagents gravam em filesystem, não no contexto principal** — o Orchestrator recebe apenas referências leves
2. **Context summary obrigatório** — cada agente resume o que fez antes de passar adiante
3. **Blockers explícitos** — se um agente está travado, ele declara o blocker ao invés de tentar resolver tudo
4. **Task ID consistente** — todos os agentes referenciam o mesmo ID de tarefa

---

## Regras de Orquestração

### O Orchestrator DEVE:
- Escalar esforço à complexidade (task simples = 1 agente, task complexa = múltiplos)
- Dar instruções detalhadas a cada subagente (objetivo, output esperado, contexto relevante)
- Evitar duplicação de trabalho entre agentes paralelos
- Definir claramente os limites de cada tarefa delegada

### Os Subagentes DEVEM:
- Operar dentro de seu escopo — nunca assumir responsabilidade de outro agente
- Retornar artifact estruturado ao completar
- Declarar blockers explicitamente ao invés de travar silenciosamente
- Usar `context_for_next` para contextualizar o próximo agente

### Paralelismo Permitido:
- **Coder + Tester** podem trabalhar em paralelo (Tester escreve testes enquanto Coder implementa)
- **Architect + DevOps** podem trabalhar em paralelo quando são tasks independentes
- **Múltiplos Coders** podem trabalhar em módulos independentes simultaneamente

---

## Memória e Contexto

### Tipos de Memória

| Tipo | Descrição | Implementação |
|------|-----------|---------------|
| **Working Memory** | Contexto da task atual | Context window do agente |
| **Episodic Memory** | Histórico de decisões da sessão | Arquivo JSON/MD na raiz da task |
| **Semantic Memory** | Conhecimento do domínio/projeto | CLAUDE.md, docs de arquitetura |
| **Artifacts** | Outputs persistidos | Arquivos no filesystem |

### Gestão de Contexto Longo

A releitura do contexto cresce com o quadrado do número de chamadas; por isso execução longa vira várias curtas (`docs/ADR-009`, limiares em `praticas/00` → bloco `orcamento-contexto`):
1. **Agente:** ao atingir o limiar de tool calls da faixa (ou de contexto), grava um checkpoint em `artifacts/{agente}-checkpoint-NN.md` e devolve `status: checkpoint`
2. **Orchestrator:** delega um subagente novo do mesmo papel com o brief, o contexto da fatia e o checkpoint — que continua de onde o anterior parou
3. **Sessão do Orchestrator:** em épica ou várias ondas, troca de sessão com `tasks/{task_id}/handoff/sessao-NN.md` e retoma com `/task retomar {task_id}`

Detalhes: `HANDOFF-PROTOCOL.md` §7.1. Disciplina de saída de ferramenta: `praticas/12`.

---

## Scaling de Esforço

| Complexidade da Task | Agentes Ativos | Tool Calls Esperados |
|---------------------|----------------|---------------------|
| Simples (bug fix, small change) | 2–3 | 5–15 por agente |
| Média (nova feature pequena) | 3–5 | 10–30 por agente |
| Complexa (sistema novo, refactor grande) | 5–8 | 20–50 por agente |
| Épica (arquitetura de produto) | Planner (fatiar) | Nenhum na task-mãe — cada fatia é uma `/task` própria |

O teto de tool calls de cada faixa é também o limiar de checkpoint do agente (`checkpoint.tool_calls_por_faixa` em `praticas/00`); o número vale do perfil do projeto, não desta tabela.

---

## Anti-Padrões a Evitar

| Anti-Padrão | Problema | Solução |
|-------------|----------|---------|
| **God Agent** | Um agente fazendo tudo | Delegar por domínio |
| **Telephone Game** | Contexto se perde entre handoffs | Artifacts estruturados + filesystem |
| **Agent Spam** | Spawnar 20 agentes para task simples | Scaling de esforço |
| **Silent Blocking** | Agente trava sem declarar blocker | Blocker explícito no artifact |
| **Scope Creep** | Agente assume responsabilidade alheia | Regras de escopo rígidas no system prompt |
| **Sequential When Parallel** | Tasks independentes rodando em fila | Identificar e paralelizar |
| **Context Bloat** | Passar contexto inteiro entre agentes | Referências a artifacts, não conteúdo |

---

## Observabilidade

Para cada run, registrar:
- Qual agente foi ativado e quando
- Inputs e outputs de cada handoff
- Número de tool calls por agente
- Custo por tipo de token e razão de cache por execução (`scripts/telemetria/relatorio-custos.mjs`, `docs/ADR-009`)
- Blockers encontrados e como foram resolvidos
- Tempo de execução por agente

---

## Estrutura de Arquivos

```
projeto/
├── CLAUDE.md                    # Contexto semântico do projeto (lido por todos os agentes)
├── praticas/                    # Biblioteca de boas práticas (critérios de decisão: código,
│                                #   arquitetura, repos, containers, EKS, DevSecOps)
├── multi-agents/
│   ├── ARCHITECTURE.md          # Este documento
│   └── agents/
│       ├── 00-orchestrator.md   # System prompt do Orchestrator
│       ├── 01-architect.md      # System prompt do Architect
│       ├── 02-planner.md        # System prompt do Planner
│       ├── 03-coder.md          # System prompt do Coder
│       ├── 04-reviewer.md       # System prompt do Reviewer
│       ├── 05-tester.md         # System prompt do Tester
│       ├── 06-debugger.md       # System prompt do Debugger
│       ├── 07-documenter.md     # System prompt do Documenter
│       ├── 08-devops.md         # System prompt do DevOps
│       ├── 09-spec-writer.md    # System prompt do Spec-Writer (SDD) — ADR-003
│       ├── 10-data-engineer.md  # System prompt do Data-Engineer — ADR-003
│       ├── 11-ai-engineer.md    # System prompt do AI-Engineer — ADR-003
│       └── 12-security-sre.md   # System prompt do Security-SRE — ADR-002
└── tasks/
    └── {task-id}/
        ├── brief.md             # Task brief inicial
        ├── artifacts/           # Outputs dos agentes
        └── memory.md            # Episodic memory da task
```

---

## Fontes e Referências

- [How we built our multi-agent research system — Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- [AgentForge: Execution-Grounded Multi-Agent Framework](https://arxiv.org/html/2604.13120)
- [LLM-Based Multi-Agent Systems for Software Engineering — ACM](https://dl.acm.org/doi/10.1145/3712003)
- [Designing LLM-based Multi-Agent Systems — arXiv](https://arxiv.org/pdf/2511.08475)
- [Choosing the Right Multi-Agent Architecture — LangChain](https://blog.langchain.com/choosing-the-right-multi-agent-architecture/)
- `03-TECHNOLOGY/Stacks-Arquiteturas-Estado-Da-Arte-2026.md` (vault externo, fora deste repo) — estudo interno que ancora os defaults de stack 2026 e motivou os 4 novos agentes.


