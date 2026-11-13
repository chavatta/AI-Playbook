# GOVERNANCE — Regras do Playbook de Desenvolvimento

> Este documento é **lei** para todo trabalho feito com este playbook — por pessoas e por agentes de IA.
> Só o Tech Lead altera este arquivo (e as travas em `.claude/`). Divergência de interpretação → o Tech Lead decide.
>
> **Dono:** Tech Lead · **Revisão:** semestral, ou a cada mudança de trava · **Última revisão:** 2026-11-05

---

## §1. Papéis

| Papel | Quem | Responsabilidade |
|---|---|---|
| **Tech Lead** | Definido por projeto | Decisão final: aprova exceções, resolve divergências, ajusta travas, define conta/organização de repos |
| **Analista/Dev** | Cada membro da equipe | Conduz as sessões de IA, revisa os PRs gerados, é **responsável pelo que a IA produz em seu nome** |
| **Agentes de IA** | Orchestrator + 12 especialistas | Executam dentro do escopo definido em `.claude/agents/` e `multi-agents/` — nunca fora dele |

---

## §2. Regras de Git

1. **`main`/`master` é intocável.** Nenhum push direto, nunca. Todo trabalho nasce em branch.
2. **Draft PR desde o início.** O trabalho sobe cedo como draft; vira ready só depois de revisado pelo Reviewer do fluxo e, quando a revisão humana for obrigatória (§3.8), também por uma pessoa, com o registro em `artifacts/revisao-humana.md`.
3. **Sem force push, sem `git reset --hard`, sem `rm -rf`.** As travas bloqueiam; se você acha que precisa, é conversa com o Tech Lead.
4. **Commits limpos:** mensagem descreve o quê e por quê. Sem marcações de IA em commits ou código.
5. **PRs pequenos:** ~200–400 linhas. Cresceu → volta ao Planner para fatiar.
6. **Branch protection no servidor é obrigatória.** Todo repo tem `main`/`master` protegida no GitHub: PR obrigatório com ≥1 aprovação, status checks verdes (onde houver CI), force push e deleção bloqueados. As travas locais (`settings.json` + hooks) são a segunda linha de defesa — a que não se contorna é a do servidor. **Transição — repo com um só mantenedor:** o GitHub não deixa ninguém aprovar o próprio PR, então a exigência fica em 0 aprovações com o PR ainda obrigatório; com o segundo revisor, sobe para 1 aprovação e inclui os administradores na regra (comandos no `ONBOARDING.md` §2 passo 5).

---

## §3. Fluxo multi-agent obrigatório

1. **Nenhuma implementação direta** sem passar pelo fluxo: toda task de dev entra pela skill `/task`, que executa o script `.claude/workflows/playbook-task.js` (`docs/ADR-005`). O script faz o reconhecimento antes de rotear, escala o fluxo enxuto (`Plan → Coder → Reviewer`) conforme a complexidade real, limita o retrabalho a duas rodadas e aplica verificação em três lentes mais refutador cego em task sensível (`multi-agents/HANDOFF-PROTOCOL.md §4, §6`). Fluxo manual pelo `orchestrator` só quando o Workflow estiver indisponível — e, nesse caso, registrado no `run-log.md`.
2. Cada agente **opera só no seu escopo** (manuais em `multi-agents/agents/`).
3. Handoffs **sempre via artifact em disco** + ponteiro leve (`multi-agents/HANDOFF-PROTOCOL.md`).
4. **Code review é obrigatório:** nenhuma task é `done` sem `tasks/{task_id}/artifacts/reviewer.md` com `**Veredito:** APROVADO` na primeira linha. O gate primário é o veredito estruturado que o script valida por schema antes de devolver `done`; o hook `check-reviewer-gate.mjs` é a segunda linha, sobre o `run-log.md`.
5. **Gate de segurança em task sensível:** task que toca auth, dados pessoais, dinheiro, superfície externa ou infra/pipeline não é `done` sem `tasks/{task_id}/artifacts/security-sre.md` com `**Veredito:** APROVADO` (agente e escopo em `docs/ADR-002-agente-security-sre.md`). O hook `check-reviewer-gate.mjs` verifica mecanicamente quando o `brief.md` marca a task como sensível. Risco residual só o Tech Lead aceita, registrado no artifact com nome e data.
6. **Biblioteca de práticas:** `praticas/` é a referência de decisão da equipe (código, arquitetura, repos, containers, segurança, testes). Não é lei — este documento é — mas desvio relevante de uma prática se justifica no ADR da decisão. Os defaults do projeto vivem em `praticas/00-stack-e-defaults.md`.
7. **Exceções:** correções triviais de 1 linha podem comprimir o fluxo para `Coder → Reviewer` (o gate continua). Protótipos exploratórios podem pular etapas **desde que marcados como protótipo não-revisado** — e nunca vão para `main` nesse estado.
8. **Revisão humana por projeto:** `revisao_humana` em `praticas/00-stack-e-defaults.md` (bloco `perfil-fluxo`) vale `obrigatoria` (padrão) ou `dispensada`, e o `brief.md` registra o valor da task — que pode subir, nunca descer abaixo do projeto. Obrigatória: a task não é `done` sem `tasks/{task_id}/artifacts/revisao-humana.md` com `**Veredito:** APROVADO` na primeira linha e o revisor identificado (`/task aprovar`). Task com dado pessoal autorizado (§7.7) é sempre obrigatória. Dispensada **não** dispensa os gates dos agentes, a decisão humana na divergência, a aceitação de risco pelo Tech Lead nem a responsabilidade do §1. Agente nunca grava veredito humano por conta própria (`docs/ADR-011`).

---

## §4. Paralelismo e sincronização segura

1. **Um dono por arquivo, sempre.** Dois agentes (ou duas pessoas) nunca editam o mesmo arquivo na mesma janela de tempo. Tasks paralelas exigem `files_changed` disjuntos.
2. **Coders paralelos = git worktrees** (branch própria por worktree). Integração via PR.
3. Arquivos de task têm escritor único: `brief.md`, `run-log.md` e `artifacts/skill-candidates.md` são do Orchestrator; cada `artifacts/{agente}.md` é do agente homônimo.
4. Repo dentro de pasta sincronizada (OneDrive/Drive)? **Evite.** Se inevitável: aguarde o sync concluir antes de paralelizar ou mergear, e nunca misture edição offline/online. Arquivo "(conflito)" apareceu → pare o paralelismo e avise o Tech Lead.
5. Em dúvida entre paralelizar e sequenciar: **sequencie.**

---

## §5. Premissas de projeto novo

1. **Repo primeiro:** criar o repositório GitHub **privado** (conta/organização definida pelo Tech Lead) antes de qualquer commit. Público só por ordem explícita do Tech Lead. **Branch protection** em `main`/`master` ativada imediatamente após criar o repo (§2.6) — é configuração do Tech Lead.
2. Nome do repo em kebab-case; remote `origin` configurado de imediato.
3. Primeiro commit mínimo: `README.md` + `.gitignore` adequado à stack.
4. Para adotar este playbook no repo novo: copie `.claude/`, `multi-agents/`, `praticas/`, `scripts/`, `gestao/` (portal de gestão, `docs/ADR-012`), `tasks/_TEMPLATE/`, `docs/` e os docs da raiz (`README.md`, `DESENVOLVIMENTO-COM-IA.md`, `ONBOARDING.md`, este arquivo) — comandos no `README.md`. No repo novo, apague `docs/patches/` (são propostas de mudança nas travas do playbook, não do projeto) e `docs/COMPETENCIA.md`, que fica só no repo do playbook (registro da organização).

---

## §6. Travas mecânicas

1. As travas vivem em `.claude/settings.json` (permissions deny) e `.claude/hooks/` (scripts). Elas **não são sugestões**: bloqueiam a ação no momento em que ela seria executada. A trava primária de git é a **branch protection no servidor** (§2.6); as locais são a segunda linha.
2. O que está travado localmente: push em `main`/`master` (qualquer sintaxe, incluindo flags e refspec `branch:main`), force push, `rm -rf`, `git reset --hard`, `git clean -f`, DDL destrutivo via CLI de banco (`DROP`/`TRUNCATE` em `psql`/`mysql`), escrita — por ferramenta de edição ou por shell — em `GOVERNANCE.md` / `.claude/settings.json` / `.claude/hooks/` / `.claude/workflows/` / `.claude/agents/`, leitura de `.env` e `.env.*` pela ferramenta de leitura, e encerramento de sessão com task `done` sem aprovação do Reviewer (e do Security-SRE, em task sensível; e da revisão humana e do registro de autorização de dado pessoal, quando o brief os exige — `docs/ADR-011`). O script `playbook-task.js` não é trava: é o fluxo. Mas ele só devolve `done` por código, após veredito validado — alterá-lo é alterar o gate, e por isso `.claude/workflows/` segue a mesma regra de mudança de `.claude/hooks/`: em branch, com o teste rodado, aplicado pelo Tech Lead. `.claude/agents/` também: o frontmatter fixa as tools e o modelo de cada agente, e agente não reescreve a própria permissão.
3. **Trava disparou → não se contorna.** Nem manualmente, nem pedindo para a IA reformular o comando. Falso positivo → reporte ao Tech Lead, que ajusta a trava pelo processo.
4. Requisito das máquinas: **Node.js ≥ 18** instalado e no PATH (os hooks são scripts Node `.mjs` — a mesma implementação roda em macOS, Linux e Windows, sem configuração por sistema) e sessões do Claude Code abertas **na raiz do repo** (os hooks usam caminho relativo e são carregados no startup — mudou hook, reinicie a sessão). Os hooks `.sh` legados permanecem no repo apenas como referência; o `settings.json` aponta para os `.mjs`. Dynamic workflows precisam estar habilitados (`/config` → Dynamic workflows; plano pago). Na primeira execução de `/task` em cada máquina o Claude Code pede aprovação do workflow — escolha "não perguntar de novo para `playbook-task` neste projeto".

---

## §7. Dados, evidência e conformidade

1. **Classificação antes do contexto.** Toda informação enviada a um modelo de IA é classificada como Pública, Interna, Confidencial ou Restrita (`praticas/10-dados-e-contexto-de-ia.md` §2). Dado **Restrito** — segredo, credencial, dado pessoal sensível (LGPD art. 5º II), dado de criança ou adolescente — **nunca entra no contexto de um modelo. Sem exceção, e nem o Tech Lead autoriza.** Dado **Confidencial** só entra com as três condições da §3 daquele documento: ferramental aprovado, contrato que cubra o subprocessamento e minimização. Se for dado pessoal comum, vale também a autorização do §7.7.
2. **A classe declarada no brief.** Todo `brief.md` declara a classe de dado da task. Classe Confidencial ou Restrita torna a task **sensível** para efeito do gate do Security-SRE (§3.5).
3. **Envio indevido é incidente, não achado.** Reportar ao Tech Lead imediatamente; se for credencial, revogar e rotacionar; se envolver dado pessoal, o Tech Lead aciona o encarregado (DPO) para avaliar o art. 48 da LGPD. Registrar no `run-log.md`. Não há punição por reportar rápido — há por esconder.
4. **Avaliação de impacto de IA.** Feature que entrega decisão ou conteúdo de IA a usuário final, processa dado pessoal com IA, ou influencia decisão sobre pessoas não é `done` sem `tasks/{task_id}/artifacts/impacto-ia.md` (`multi-agents/templates/AVALIACAO-IMPACTO-IA.template.md`), auditado pelo Security-SRE.
5. **Evidência é versionada.** `tasks/` não entra no `.gitignore`. Brief, run-log e artifacts são retidos por **3 anos** (`docs/EVIDENCIAS-E-METRICAS.md` §2). Artifact registra veredito e racional — nunca dado real de cliente ou pessoal.
6. **Revisão periódica.** Cada documento do playbook tem dono e cadência declarados em `docs/EVIDENCIAS-E-METRICAS.md` §4. Revisão feita atualiza a data no cabeçalho, mesmo sem alteração de conteúdo.
7. **Dado pessoal autorizado pelo cliente.** Dado pessoal **comum** de cliente só entra no contexto com autorização vigente do cliente, registrada pelo Tech Lead em `docs/autorizacoes/` (`multi-agents/templates/AUTORIZACAO-DADOS-PESSOAIS.template.md`), além das condições do §7.1. A autorização vale só para a finalidade, as categorias, os sistemas, os provedores e a validade registrados. Não substitui a base legal nem o contrato com o provedor, e **não alcança** o dado Restrito. A task declara o registro no `brief.md`, é sensível e exige revisão humana (§3.8). O hook confere, no `done`, o registro e a validade. Dado pessoal real continua proibido em artifact, run-log, fixture, teste, log e commit (`praticas/10` §3.1, `docs/ADR-011`).
