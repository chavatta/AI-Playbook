# ONBOARDING — Comece Aqui

> Guia de entrada para analistas usando o fluxo multi-agent do playbook.
> Leitura obrigatória antes: [DESENVOLVIMENTO-COM-IA.md](DESENVOLVIMENTO-COM-IA.md) (o porquê de tudo isso).
>
> **Dono:** Tech Lead · **Revisão:** semestral · **Última revisão:** 2026-09-23

---

## 1. O que é este playbook

Um padrão de desenvolvimento com IA baseado em **um time de agentes especializados** (1 orquestrador + 12 especialistas), com:

- **Handoffs em disco:** cada agente grava seu trabalho completo em `tasks/{task_id}/artifacts/` e devolve só um ponteiro leve — nada se perde entre etapas.
- **Gates obrigatórios:** nada é `done` sem review aprovado; tasks sensíveis passam também pelo gate de segurança; `main` é intocável.
- **Travas mecânicas:** os limites são aplicados por configuração e hooks, não por confiança.
- **Classificação de dado antes do prompt:** o que pode entrar no contexto de um modelo tem regra própria em [`praticas/10-dados-e-contexto-de-ia.md`](praticas/10-dados-e-contexto-de-ia.md) — é a única trava que depende de você, porque nenhum hook consegue aplicá-la.
- **Biblioteca de boas práticas:** critérios de decisão de mercado (clean code, clean architecture, monorepo, containers, EKS, DevSecOps…) em [`praticas/`](praticas/README.md), consultados pelos agentes e por você.

---

## 2. Setup (uma vez por máquina)

1. Instale o [Claude Code](https://claude.com/claude-code) e autentique.
2. Instale o [Node.js](https://nodejs.org) ≥ 18 (`brew install node` / `winget install OpenJS.NodeJS.LTS`) — os hooks são scripts Node e rodam idênticos em macOS, Linux e Windows, sem configuração por sistema.
3. Clone o repo do projeto (que já contém a pasta `.claude/` deste playbook).
4. Abra o Claude Code **na raiz do repo** — os agentes, travas e hooks carregam automaticamente no startup (os hooks usam caminho relativo; abrir fora da raiz os desativa).
4b. **Declare o plano da assinatura desta máquina:** `node scripts/plano-assinatura.mjs`. O script lê o plano em `claude auth status` e grava em `.claude/settings.local.json` (não versionado) qual modelo o Security-SRE usa: Fable no Max e em assento premium, Opus no Pro e em assento standard, onde o Fable sairia em crédito avulso. Em Team e Enterprise, informe o assento com `--assento premium` ou `--assento standard`. Se o plano detectado estiver errado, declare à mão com `--plano`. Depois **reinicie o Claude Code**. O `/task` confere isso antes de rodar (`docs/ADR-010`).
5. **(Tech Lead, uma vez por repo)** Ative **branch protection** em `main`/`master` no GitHub: PR obrigatório, ≥1 aprovação, status checks verdes onde houver CI, force push e deleção bloqueados (Settings → Branches, ou `gh api`). Os hooks locais do playbook são a segunda linha de defesa — a trava que não se contorna é a do servidor, e ela não vem no clone.

   **Repo com um só mantenedor:** o GitHub não permite aprovar o próprio PR, então exigir 1 aprovação faria todo merge depender do bypass de admin — e trava que só se cumpre por bypass ensina a equipe a usar bypass. Nesse caso, configure **0 aprovações mantendo o PR obrigatório**: nada entra em `main` por push direto e o histórico de revisão continua registrado. Suba para **1 aprovação + `enforce_admins`** assim que houver um segundo revisor. É configuração de transição — formalizada em `GOVERNANCE.md` §2.6 (patch pendente em `docs/patches/`).

   Comandos para subir a proteção quando chegar o segundo revisor (troque `<org>/<repo>`):

   ```bash
   gh api -X PATCH repos/<org>/<repo>/branches/main/protection/required_pull_request_reviews -F required_approving_review_count=1
   gh api -X PUT repos/<org>/<repo>/branches/main/protection/enforce_admins
   ```

   O `-F` maiúsculo importa: `required_approving_review_count` é inteiro, e `-f` manda string, que a API rejeita com HTTP 422.

6. **(uma vez por projeto)** Preencha [`praticas/00-stack-e-defaults.md`](praticas/00-stack-e-defaults.md) com os defaults **deste** projeto: cloud, região, linguagens e versões, banco, CI, secrets. O 00 é **por projeto, não global** — dois repos podem ter stacks diferentes, e cada um carrega o seu. Preencher o que já estiver decidido; não trave o início do projeto tentando fechar todos os campos. No bloco **Orçamento de contexto e execução**, preencha ao menos `comandos_quiet` (teste, lint, análise estática); os limiares já vêm com default (`docs/ADR-009`).

**Campo em branco não bloqueia o trabalho — vira um menu.** Na primeira task que esbarrar num campo vazio, o Architect apresenta as **opções candidatas** daquele campo (o próprio 00 já traz uma coluna com elas, com um ponto de partida marcado ★), **uma recomendação com o porquê em uma linha**, e a opção explícita **"decida você, Architect"** — que é a resposta certa quando você não tem preferência e quer seguir sem parar a task. Escolhida a opção ou delegada ao Architect, a decisão vira ADR e o valor volta para o 00; a partir daí é default do projeto e ninguém re-decide. Campo já preenchido, ao contrário, **vence preferência de agente e de dev**: desviar dele exige ADR.

Os campos marcados 🔒 no 00 escalam ao **Tech Lead**, não ao Architect — custo recorrente, contrato com terceiro, risco jurídico ou de dados pessoais não são decisão de projeto.

Para adotar o playbook em um repo que ainda não o tem: copie `.claude/`, `multi-agents/`, `praticas/`, `scripts/`, `tasks/_TEMPLATE/` (não as tasks deste próprio playbook), `docs/`, `GOVERNANCE.md`, `README.md`, `DESENVOLVIMENTO-COM-IA.md` e este arquivo para a raiz do repo — detalhe completo em [README.md](README.md#adotando-em-um-repositório). No repo novo, apague `docs/patches/` (são propostas de mudança nas travas *deste* playbook) e `docs/COMPETENCIA.md`, que fica só no repo do playbook. Preencha o `praticas/00` do projeto novo (passo 6), que não vem preenchido do repo de origem.

---

## 3. Os 13 agentes e seus modelos

| Agente | Família | Função | Quando entra |
|---|---|---|---|
| `orchestrator` | Opus | Decompõe, delega, coordena, sintetiza | Sempre — ponto de entrada |
| `architect` | Opus | Design e decisões técnicas | Feature nova, refactor, decisão de stack |
| `planner` | Sonnet | Fatia design em tasks INVEST com critérios | Depois do Architect |
| `coder` | Sonnet · Opus na escalada | Implementa a spec | Depois do Planner |
| `reviewer` | Opus | **Gate de qualidade obrigatório** | Depois do Coder, sempre |
| `tester` | Sonnet | Testes e validação | Em paralelo ou após o Coder |
| `debugger` | Opus | Root cause de bugs | Teste falhou / bug reportado |
| `documenter` | Haiku | Docs técnicos | Após aprovação do Reviewer |
| `devops` | Sonnet | CI/CD, deploy, infra | Tasks de infra |
| `spec-writer` | Opus | Spec formal e verificável antes de arquitetura e código (SDD) | Primeiro passo de feature não-trivial |
| `data-engineer` | Opus | Schema Postgres, migrations expand-contract, RLS, pgvector | Camada de dados é o foco da task |
| `ai-engineer` | Opus | RAG, agentes, prompts, evals, guardrails | Task envolve subsistema de IA/LLM |
| `security-sre` | Fable · Opus no Pro | **Gate de segurança sistêmico** (threat model, supply chain, secrets, pipeline) + prontidão de produção | Task toca auth, dados pessoais, dinheiro, superfície externa ou infra |

A família entra sem versão: cada versão nova chega sozinha, e o agente bloqueia se rodar abaixo do piso (Opus, Sonnet e Haiku ≥ 5.5, Fable ≥ 5.1). Esforço e escalada do Coder: `DESENVOLVIMENTO-COM-IA.md` §3.

Por que esses modelos: [docs/ADR-010-familias-e-esforco-por-agente.md](docs/ADR-010-familias-e-esforco-por-agente.md), [docs/ADR-001-modelos-por-agente.md](docs/ADR-001-modelos-por-agente.md), [docs/ADR-002-agente-security-sre.md](docs/ADR-002-agente-security-sre.md) e [docs/ADR-003-agentes-sdd-dados-ia.md](docs/ADR-003-agentes-sdd-dados-ia.md).

---

## 4. Como trabalhar no dia a dia

### Peça pelo /task

Para qualquer task não-trivial, dispare o fluxo pela skill — por exemplo:

> `/task implementar endpoint de exportação CSV no serviço de relatórios, com paginação`

Sob o ADR-005, `/task` é o ponto de entrada: o script `.claude/workflows/playbook-task.js` roda o recon (o Architect em modo levantamento) e é ele quem classifica a complexidade real antes de rotear. O fluxo manual abaixo — pedir pelo orchestrator em prosa — continua como fallback para quando o Workflow estiver indisponível (Dynamic workflows precisa estar habilitado em `/config`, e exige plano pago); use-o e registre o motivo no `run-log.md`.

| Complexidade | Fluxo |
|---|---|
| Trivial (1 linha) | Coder → Reviewer (gate continua) |
| Simples / média / complexa | Plan (architect+planner) → Coder ∥ Tester → Reviewer; Debugger sob demanda |
| Feature não-trivial (SDD) | Spec-Writer antes do Architect |
| Dados / IA como foco | + Data-Engineer / AI-Engineer nos seus gatilhos |
| Sensível (auth, dados, dinheiro, superfície externa, infra) | Reviewer ∥ Security-SRE ∥ Tester em paralelo, com unanimidade, + refutador cego |
| Épica | Fatiada pelo Planner — cada fatia vira uma `/task`; a task-mãe não recebe código |

### Anatomia de uma task

```
tasks/2026-07-31_export-csv/
├── brief.md        # objetivo, escopo, critérios (Orchestrator)
├── run-log.md      # linha do tempo append-only — auditoria da execução
├── memory.md       # decisões da sessão
├── handoff/        # sessao-NN.md — troca de sessão em épica ou várias ondas (ADR-009)
└── artifacts/      # trabalho completo de cada agente (+ {agente}-checkpoint-NN.md, se houve checkpoint)
    ├── architect.md
    ├── planner.md
    ├── coder.md
    ├── reviewer.md      ← sem APROVADO aqui, a task não fecha
    └── security-sre.md  ← obrigatório também, se a task for sensível
```

### Seu papel humano

1. Descreva bem o objetivo (o brief nasce da sua descrição).
2. Responda blockers quando um agente perguntar.
3. **Leia o diff inteiro** do PR antes de marcar ready — a responsabilidade é sua.
4. Merge é decisão humana, sempre via PR revisado.

---

## 5. Gates que você vai encontrar

| Gate | O que exige | Quem verifica |
|---|---|---|
| **Reviewer gate** | `artifacts/reviewer.md` com `APROVADO` antes de `done` | Hook `check-reviewer-gate.mjs` + Orchestrator |
| **Security gate** | Task sensível: `artifacts/security-sre.md` com `**Veredito:** APROVADO` antes de `done` | Hook `check-reviewer-gate.mjs` (quando o brief marca a task como sensível) + Orchestrator |
| **Git gate** | Branch + draft PR; nunca push em `main`, force ou reset | Branch protection no GitHub (primária) + deny do `settings.json` + hook `block-dangerous-git.mjs` |
| **Guardrail gate** | Agentes não alteram `GOVERNANCE.md`, `settings.json`, hooks | Deny + hook `protect-guardrails.mjs` |
| **Skill gate** | Skill nova só com regra dos 3 + aprovação | Orchestrator/Tech Lead ([SKILLS-GOVERNANCE](multi-agents/SKILLS-GOVERNANCE.md)) |

**Uma trava disparou?** A mensagem diz o caminho certo (ex.: push bloqueado → abra PR). Se parecer falso positivo, **não contorne** — reporte ao Tech Lead ([GOVERNANCE.md](GOVERNANCE.md) §6).

Falso positivo é bug da trava, e trata-se como bug: reproduza o comando exato, registre-o e leve ao Tech Lead. O conserto vem em branch, com o banco de payloads provando o caso novo sem afrouxar os antigos, e quem aplica o arquivo em `.claude/hooks/` é o Tech Lead — nem o agente que achou o problema tem escrita ali. O que **não** vale é reescrever o comando só para escapar do padrão: isso enterra o bug e deixa a trava pior para quem vier depois.

---

## 6. Erros comuns de quem está começando

- **Pedir código direto ao Claude, fora do fluxo** → sem review, sem rastro. Use `/task` (ou o orchestrator em prosa, só se o Workflow estiver indisponível).
- **Aceitar diff gigante** → peça para fatiar; PRs de ~200–400 linhas.
- **Confiar no "está pronto" da IA** → pronto é: critérios atendidos + Reviewer APROVADO + você leu o diff.
- **Editar o mesmo arquivo que um agente está editando** → um dono por arquivo ([GOVERNANCE.md](GOVERNANCE.md) §4).
- **Reaproveitar sessão com hooks alterados** → hooks carregam no startup; reinicie a sessão.
- **Deixar worktree para trás depois do merge** → `.claude/worktrees/` é ignorada pelo git, então a cópia órfã não aparece no `git status` e sobrevive indefinidamente. Depois que a branch mergear, `git worktree remove <caminho>` e apague a branch.
- **Uma sessão só para a épica inteira** → ao fechar cada onda (ou quando o aviso `[orçamento de contexto]` pedir), a sessão grava o handoff; faça `/clear` e `/task retomar <task_id>`. A sessão longa relê tudo a cada turno ([ADR-009](docs/ADR-009-eficiencia-de-contexto-e-cache.md)).
- **Colar log inteiro de teste ou de CI na conversa** → cada token colado é relido em toda chamada seguinte. Use os wrappers `scripts/quiet/` e aponte o arquivo ([praticas/12](praticas/12-disciplina-de-saida-de-ferramenta.md)).
- **Comparar contra um `main` local desatualizado** → antes de concluir que uma branch "está na frente", rode `git fetch` e compare com `origin/main`. Branch que parece adiantada costuma ser `main` que ficou para trás.

---

## 7. Referências

- [DESENVOLVIMENTO-COM-IA.md](DESENVOLVIMENTO-COM-IA.md) — riscos, cuidados e boas práticas (leitura nº 1)
- [GOVERNANCE.md](GOVERNANCE.md) — a lei: papéis, git, gates, travas
- [multi-agents/ARCHITECTURE.md](multi-agents/ARCHITECTURE.md) — doutrina completa
- [multi-agents/HANDOFF-PROTOCOL.md](multi-agents/HANDOFF-PROTOCOL.md) — o protocolo na prática
- [multi-agents/SKILLS-GOVERNANCE.md](multi-agents/SKILLS-GOVERNANCE.md) — reuso e criação de skills
- [praticas/README.md](praticas/README.md) — biblioteca de boas práticas (decisão de arquitetura, código, infra, segurança)
- `multi-agents/agents/NN-*.md` — manual completo de cada agente
