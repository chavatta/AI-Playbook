# Desenvolvimento com IA — Como Trabalhamos, Riscos e Cuidados

> **Leia este documento antes de qualquer outro.** Ele explica por que nosso fluxo de desenvolvimento com IA é estruturado do jeito que é.
>
> **Dono:** Tech Lead · **Revisão:** semestral · **Última revisão:** 2026-09-23

---

## 1. Por que este documento existe

IA acelera desenvolvimento de forma real — mas **sabemos que implementar com IA tem riscos e exige cuidados**. Sem método, os problemas aparecem rápido:

- Código gerado que **parece certo e está errado** (APIs alucinadas, edge cases ignorados, lógica sutilmente quebrada).
- Mudanças grandes demais para alguém revisar de verdade — o review vira teatro.
- Ações destrutivas executadas com confiança: push em `main`, `rm -rf`, reset de histórico.
- Segredos e credenciais parando em código ou em contexto de IA.
- Perda de rastreabilidade: ninguém sabe o que foi decidido, por quem, nem por quê.

Nossa postura é simples: **IA com processo de engenharia, não IA no improviso.** Cada risco acima tem uma mitigação concreta neste playbook — por método e por trava mecânica, não por confiança.

---

## 2. Como funciona o time de agentes

Não usamos "uma IA que faz tudo". Usamos um **time de agentes especializados**, espelhando um time real de desenvolvimento:

```
                    ORCHESTRATOR  (coordena — como um tech lead)
                         │
   ┌──────────┬──────────┼──────────┬──────────┬──────────┐
SPEC-WRITER ARCHITECT  PLANNER    CODER     REVIEWER   TESTER
(especifica) (projeta)  (fatia) (implementa) (audita)  (valida)
                         │
   ┌──────────┬──────────┼──────────┬──────────┬──────────┐
DEBUGGER  DOCUMENTER   DEVOPS  DATA-ENGINEER AI-ENGINEER SECURITY-SRE
(diagnostica)(documenta) (infra)   (dados)     (IA/RAG)  (gate de segurança)
```

| Agente | Papel no time | Equivalente humano |
|---|---|---|
| **Orchestrator** | Decompõe o pedido, delega, coordena, sintetiza. Não escreve código. | Tech Lead |
| **Architect** | Design de sistema e decisões técnicas, antes de qualquer código | Arquiteto de Software |
| **Planner** | Quebra o design em tasks pequenas com critérios de aceitação | Analista / PO técnico |
| **Coder** | Implementa exatamente o que a spec pede | Desenvolvedor |
| **Reviewer** | Audita segurança, performance e correção — **gate obrigatório** | Revisor sênior |
| **Tester** | Escreve e executa testes; valida critérios de aceitação | QA |
| **Debugger** | Reproduz, isola e diagnostica root cause | Especialista em troubleshooting |
| **Documenter** | READMEs, API docs, runbooks — só após aprovação | Technical Writer |
| **DevOps** | CI/CD, deploy, infra — com checklist pré-deploy | Engenheiro DevOps |
| **Spec-Writer** | Spec formal e verificável antes de arquitetura e código (SDD) | Analista de Requisitos |
| **Data-Engineer** | Schema, migrations seguras, RLS, pgvector — dono da camada de dados | Engenheiro de Dados / DBA |
| **AI-Engineer** | RAG, agentes, prompts, evals, guardrails — dono do subsistema de IA | Engenheiro de IA/ML |
| **Security-SRE** | Segurança sistêmica (threat model, supply chain, secrets, pipeline) + prontidão de produção — **gate das tasks sensíveis** | Engenheiro de Segurança / SRE |

**Por que separar papéis reduz erro:**

1. **Especialização** — cada agente faz uma coisa e faz bem; não mistura responsabilidades.
2. **Revisão cruzada** — quem escreve o código nunca é quem aprova. O Coder não revisa o próprio trabalho, exatamente como num time maduro.
3. **Escopo limitado por ferramenta** — cada agente só tem acesso às ferramentas do seu papel. O Reviewer não tem ferramenta de edição de código (sem `Edit`); grava só o próprio artifact (`tasks/{id}/artifacts/reviewer.md` — o `Write` é geral, a restrição é do manual, não da ferramenta) e lê o que precisar (`Read`/`Glob`/`Grep`/`Bash`); o Planner não executa comandos; o Debugger não corrige em produção (entrega diagnóstico ao Coder).
4. **Handoff estruturado** — o trabalho passa de agente para agente via artifacts gravados em disco, com rastro auditável (`tasks/{id}/run-log.md`). Nada se perde em "telefone sem fio".

O Orchestrator continua no topo do time, mas deixou de ser o ponto de entrada literal: sob o `docs/ADR-005-orquestracao-nativa-do-fluxo.md`, quem abre a task é a skill `/task` (`.claude/workflows/playbook-task.js`), que roda o recon e roteia por código — o `GOVERNANCE.md` já traz o fluxo por script (patch aplicado em 2026-09-29); a vigência plena depende do piloto. O fluxo manual pelo Orchestrator segue como fallback quando o Workflow não está disponível.

Detalhe completo: [multi-agents/ARCHITECTURE.md](multi-agents/ARCHITECTURE.md) e [multi-agents/HANDOFF-PROTOCOL.md](multi-agents/HANDOFF-PROTOCOL.md).

---

## 3. O modelo certo para cada função

Modelos de IA têm capacidades e custos diferentes. Desde 2026-10-23 (ADR-010), cada agente declara uma **família** de modelo, e não uma versão fixa. Quando sai uma versão nova da família, ela entra sozinha, e cada agente bloqueia se rodar abaixo do piso (Opus ≥ 5.5, Sonnet ≥ 5.5, Haiku ≥ 5.5, Fable ≥ 5.1). O **Opus** fica onde o erro é caro de reverter ou passa despercebido: decomposição, spec, design, dados, IA e o gate de review. O **Sonnet 5.5** fica com quem trabalha sob spec fechada e com gate logo depois, e o Coder sobe para Opus quando a fatia é de alto risco. O gate de segurança roda em **Fable**, outra família, quando o plano da assinatura inclui Fable; no Pro, roda em Opus. Todo agente declara o esforço (`effort`), para que ele não dependa da configuração de cada máquina.

| Agente | Família (esforço) | Por quê |
|---|---|---|
| Orchestrator | **Opus** (high) | A decomposição define a qualidade de tudo que vem depois |
| Spec-Writer | **Opus** (high) | A spec é o contrato de tudo que vem depois; uma ambiguidade nela vira retrabalho em todos os agentes seguintes |
| Architect | **Opus** (high) | Decisões de arquitetura são caras de reverter |
| Reviewer | **Opus** (high) | É o gate: um falso "aprovado" é o erro mais caro do fluxo. Volta a ser mais forte que o Coder que audita |
| Debugger | **Opus** (high) | Diagnóstico de causa-raiz é raciocínio aberto, sem spec que o guie |
| Data-Engineer | **Opus** (high) | Migration e RLS erradas são caras de reverter e podem expor dado entre tenants |
| AI-Engineer | **Opus** (high) | Prompt, RAG e evals mal desenhados falham em silêncio: o sistema responde, só que errado |
| Planner | Sonnet (high) | Fatia trabalho sobre um design já decidido |
| Tester | Sonnet (high) | Testa critérios de aceitação já escritos; também é a lente de reprodução em task sensível |
| DevOps | Sonnet (high) | Procedural, com checklist pré-deploy; o Sonnet 5.5 lidera em agente de terminal |
| Coder | Sonnet (high) → **Opus** na escalada | Implementa a spec sob o gate do Reviewer. Sobe para Opus em task sensível, migração de dados, complexidade `complexa` ou rodada depois de um REPROVADO |
| Documenter | Haiku (medium) | Alto volume, insumo já aprovado |
| Security-SRE | **Fable** (high) · Opus no Pro | É um gate: um falso "aprovado" de segurança é vulnerabilidade em produção. No Pro e em assento standard o Fable sai em crédito avulso, e quem o chama (`/task` e Orchestrator) passa `model: opus` pelo plano declarado na máquina (`scripts/plano-assinatura.mjs`) |

Racional completo e alternativas descartadas: [docs/ADR-010-familias-e-esforco-por-agente.md](docs/ADR-010-familias-e-esforco-por-agente.md), [docs/ADR-001-modelos-por-agente.md](docs/ADR-001-modelos-por-agente.md), [docs/ADR-002-agente-security-sre.md](docs/ADR-002-agente-security-sre.md) e [docs/ADR-003-agentes-sdd-dados-ia.md](docs/ADR-003-agentes-sdd-dados-ia.md).

---

## 4. Os riscos que reconhecemos — e como cada um é mitigado

| Risco real de dev com IA | Nossa mitigação |
|---|---|
| Código errado ou alucinado que "parece certo" | **Reviewer obrigatório** (Opus): nenhuma task fecha sem `artifacts/reviewer.md` com aprovação explícita — verificado por hook, não por boa vontade |
| Ação destrutiva no repositório | Hooks **bloqueiam** push em `main`/`master` (inclusive `HEAD:main`), force push, `rm -rf`, `git reset --hard` |
| Mudança grande demais para revisar | Planner fatia em mudanças de ~200–400 linhas; diff maior que isso é sinalizado no review |
| Escopo descontrolado (IA "aproveita para arrumar" o que ninguém pediu) | Delegação com **LIMITES explícitos**; um dono por arquivo; agente fora do escopo = anti-padrão registrado |
| Contexto se perdendo entre etapas | Artifacts completos em disco + ponteiros leves; `run-log.md` append-only com a linha do tempo de cada task |
| Dado de cliente, PII ou informação confidencial indo parar no contexto de um modelo externo | **Classificação obrigatória** em [praticas/10-dados-e-contexto-de-ia.md](praticas/10-dados-e-contexto-de-ia.md): quatro classes, três condições para dado confidencial, e proibição sem exceção para dado restrito. Declarada no `brief.md` de cada task |
| Sistema de IA entregue ao cliente causando dano a pessoas (viés, decisão sem recurso, erro invisível) | **Avaliação de impacto de IA** por gatilho ([template](multi-agents/templates/AVALIACAO-IMPACTO-IA.template.md), ISO 42001 A.5), auditada pelo Security-SRE |
| Segredo/credencial em código | Regra dura no Coder (sem hardcode) + item obrigatório do checklist do Reviewer; segredos só em cofre/secrets do CI. Secret commitado = revogar e rotacionar |
| Vulnerabilidade sistêmica (dependência comprometida, pipeline inseguro, authZ falha) | **Security-SRE** como gate em toda task sensível: threat model, auditoria de supply chain, secrets, pipeline e runtime — método em [praticas/06-devsecops.md](praticas/06-devsecops.md) |
| Decisão de arquitetura/infra por moda (microsserviço prematuro, EKS sem motivo) | Biblioteca [`praticas/`](praticas/README.md): critérios de decisão explícitos que o Architect cita no ADR — "é o padrão da indústria" não é justificativa |
| Excesso de confiança ("a IA disse que está pronto") | Nada é `done` sem passar pelo gate; o dev revisa o PR antes de marcá-lo ready — **responsabilidade final é humana** |
| A própria IA alterar suas travas | `settings.json`, hooks e GOVERNANCE são zonas negadas para escrita pelos agentes |

---

## 5. As travas mecânicas (não são opcionais)

Regra de processo depende de obediência; **trava mecânica não**. O kit traz as duas camadas:

- **`.claude/settings.json` → `permissions.deny`** — nega de saída: push direto em `main`, force push, `rm -rf`, `git reset --hard`, `git clean -f`, e qualquer escrita em `GOVERNANCE.md`, `.claude/settings.json` e `.claude/hooks/`. O deny simples só casa `git clean -fd` literal; as demais variantes com `-f` (`-fdx`, `-f -d`, flags reordenadas) são bloqueadas pelo `block-dangerous-git.mjs` logo abaixo, não pelo deny.
- **Hooks (scripts Node que interceptam as ações da IA — a mesma implementação roda em macOS, Linux e Windows, sem configuração por sistema):**
  - `block-dangerous-git.mjs` — analisa cada comando antes de executar; bloqueia variações que burlam o deny simples (ex.: `git push origin HEAD:main`, flags reordenadas, ofuscação por aspas) e os equivalentes Windows (`Remove-Item -Recurse -Force`, `rmdir /s`). O casamento é **por posição de comando**: o padrão perigoso só bloqueia quando está no início da linha ou logo após um separador (`;`, `&&`, `|`), de modo que *citar* o comando como texto — um `grep` na documentação, um `echo` explicativo — não dispara a trava. A exceção são os wrappers que executam string como código (`sh -c`, `eval`, `xargs`): neles o conteúdo citado **é** comando, e a checagem volta a valer em qualquer posição.
  - `protect-guardrails.mjs` — impede a IA de editar as próprias travas e a governança, cobrindo caminhos absolutos e caminhos Windows (`C:\...\.claude\settings.json`). Ele intercepta as ferramentas de escrita; o caminho por shell (`cp`, `tee`, `>`, `sed -i` para `.claude/` ou `GOVERNANCE.md`) é fechado pelo `block-dangerous-git.mjs`, que continua permitindo **ler** esses arquivos.
  - `check-reviewer-gate.mjs` — no fim de cada sessão, verifica se alguma task foi marcada `done` sem `**Veredito:** APROVADO` do Reviewer — e, em task marcada como sensível no brief, também do Security-SRE; se sim, bloqueia o encerramento.

**Regra de ouro:** trava disparou → **não se contorna**. Nem manualmente "só dessa vez". Se parecer falso positivo, reporte ao Tech Lead — a trava é ajustada pelo processo, nunca ignorada.

Ajustar uma trava é, ele próprio, um fluxo com gate: a mudança nasce em branch, vem acompanhada do **banco de payloads** que prova o caso novo (o que passou a bloquear e o que passou a liberar) rodado contra a versão antiga e a nova, e é **o Tech Lead quem aplica o arquivo** — os agentes não têm escrita em `.claude/hooks/` nem em uma sessão que está corrigindo o próprio hook. Guardrail sem teste de regressão é guardrail que ninguém confia depois do primeiro falso positivo.

---

## 6. Boas práticas de desenvolvimento com IA

1. **Branch + draft PR sempre.** `main` é intocável. Todo trabalho nasce em branch, sobe como draft PR e só vira ready depois de revisado.
2. **Mudanças pequenas.** ~200–400 linhas por PR. Se cresceu, volta pro Planner fatiar.
3. **Critérios de aceitação antes do código.** Se você não sabe dizer quando está pronto, não está pronto para começar.
4. **Testes são contrato, não enfeite.** O Tester valida os critérios; teste falhando → Debugger, não gambiarra.
5. **Você é responsável pelo que a IA produziu em seu nome.** Leia o diff inteiro antes de abrir o PR. "Foi a IA" não é justificativa em code review.
6. **Commits limpos.** Mensagens descritivas do quê e por quê. Sem marcações de IA no código ou nos commits.
7. **Um dono por arquivo por vez.** Trabalho paralelo usa git worktrees e arquivos disjuntos (ver [GOVERNANCE.md](GOVERNANCE.md) §4). Worktree criada por sessão do Claude Code mora em `.claude/worktrees/` — **ignorada pelo git**, porque versionar um checkout aninhado duplicaria a árvore. Ela não se limpa sozinha: quando a branch dela mergear, remova com `git worktree remove <caminho>` e apague a branch, ou o repo acumula cópias antigas que confundem qualquer comparação futura.
8. **Registre decisões.** Decisão técnica relevante vira ADR em `docs/` — quem chegar depois entende o porquê.
9. **Consulte a biblioteca antes de decidir.** Modularização, monorepo, containerizar ou não, EKS ou não, clean architecture, design funcional: os critérios estão em [`praticas/`](praticas/README.md). Desvio relevante se justifica no ADR.
10. **Os defaults do projeto vivem no `praticas/00`.** [`praticas/00-stack-e-defaults.md`](praticas/00-stack-e-defaults.md) é preenchido **por projeto**, no início dele (ONBOARDING §2, passo 6) — cada repo carrega o seu. O que estiver preenchido é decidido: vence preferência de agente e de dev, e desviar exige ADR. O que estiver em branco **não é blocker — é um menu**: o Architect apresenta as opções candidatas do campo (o 00 já traz uma coluna com elas), uma recomendação com o porquê, e a opção explícita **"decida você, Architect"** para quando você não tem preferência. A escolha vira ADR e o valor volta para o 00, para que ninguém re-decida depois. Campos marcados 🔒 escalam ao Tech Lead, não ao Architect.
11. **Segurança entra no começo, não no fim.** Feature sensível ganha threat model no design e passa pelo gate do Security-SRE antes de fechar ([praticas/06-devsecops.md](praticas/06-devsecops.md)).
12. **Na dúvida, pergunte.** Ambiguidade que muda a abordagem → pergunta ao Tech Lead antes, não suposição depois.

---

## 7. O que a IA NUNCA faz aqui

- Merge ou push em `main`/`master`.
- Deploy sem o checklist pré-deploy do DevOps.
- Criar, ler ou manipular credenciais e segredos.
- Apagar dados ou histórico (`rm -rf`, force push, hard reset).
- Alterar as próprias travas: `.claude/settings.json`, `.claude/hooks/`, `GOVERNANCE.md`.
- Marcar trabalho como concluído sem passar pelo gate do Reviewer — e, em task sensível, também pelo gate do Security-SRE.
- Aceitar risco de segurança em nome do projeto — risco residual só o Tech Lead aceita, por escrito.

---

## 8. Onde aprender o resto

| Documento | O que cobre |
|---|---|
| [ONBOARDING.md](ONBOARDING.md) | Passo a passo para começar a usar o fluxo |
| [GOVERNANCE.md](GOVERNANCE.md) | Papéis, regras de git, gates e travas — a "lei" do playbook |
| [multi-agents/ARCHITECTURE.md](multi-agents/ARCHITECTURE.md) | Doutrina: topologia, fluxos, anti-padrões, scaling de esforço |
| [multi-agents/HANDOFF-PROTOCOL.md](multi-agents/HANDOFF-PROTOCOL.md) | Como os agentes trocam trabalho na prática |
| [multi-agents/SKILLS-GOVERNANCE.md](multi-agents/SKILLS-GOVERNANCE.md) | Quando reutilizar/criar skills (regra dos 3) |
| [docs/ADR-001-modelos-por-agente.md](docs/ADR-001-modelos-por-agente.md) | Por que cada agente usa o modelo que usa |
| [docs/ADR-002-agente-security-sre.md](docs/ADR-002-agente-security-sre.md) | Escopo e fronteiras do gate de segurança |
| [docs/ADR-003-agentes-sdd-dados-ia.md](docs/ADR-003-agentes-sdd-dados-ia.md) | Escopo e modelos do Spec-Writer, Data-Engineer e AI-Engineer |
| [docs/ADR-004-conformidade-iso.md](docs/ADR-004-conformidade-iso.md) | Como o playbook se posiciona perante ISO 27001 e ISO 42001 |
| [docs/ADR-005-orquestracao-nativa-do-fluxo.md](docs/ADR-005-orquestracao-nativa-do-fluxo.md) | Por que o fluxo roda como script nativo do Claude Code (`/task`), e não por orquestrador externo |
| [docs/ADR-007-roteamento-multi-provedor.md](docs/ADR-007-roteamento-multi-provedor.md) | Roteamento de papel para lista ordenada de (provedor, modelo) — proposto |
| [docs/ADR-008-contrato-de-telemetria.md](docs/ADR-008-contrato-de-telemetria.md) | Contrato de telemetria do fluxo: evento, hook emissor e `decisions.md` — proposto |
| [docs/ADR-009-eficiencia-de-contexto-e-cache.md](docs/ADR-009-eficiencia-de-contexto-e-cache.md) | Como o fluxo reduz escrita e releitura de cache e o tamanho do contexto, e como medir |
| [docs/ADR-010-familias-e-esforco-por-agente.md](docs/ADR-010-familias-e-esforco-por-agente.md) | Família de modelo por alias com piso de versão, esforço explícito, executores em Sonnet 5.5 e Security-SRE pelo plano da assinatura |
| [docs/ISO-MAPPING.md](docs/ISO-MAPPING.md) | Rastreabilidade controle → evidência → status; o documento que vai ao auditor |
| [docs/EVIDENCIAS-E-METRICAS.md](docs/EVIDENCIAS-E-METRICAS.md) | O que é evidência, por quanto tempo se retém, e como medir se o playbook funciona |
| [praticas/README.md](praticas/README.md) | Biblioteca de boas práticas: código, arquitetura, repos, infra, segurança |
| [praticas/00-stack-e-defaults.md](praticas/00-stack-e-defaults.md) | Defaults **deste projeto** (cloud, linguagens, banco, CI); campo em branco = decisão do Architect |
| `multi-agents/agents/NN-*.md` | Manual completo de cada agente |
