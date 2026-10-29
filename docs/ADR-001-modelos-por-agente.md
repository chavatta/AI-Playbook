# ADR-001 — Modelo de IA por Agente

**Status:** Aceito — complementado por ADR-002 (Security-SRE) e ADR-003 (Spec-Writer, Data-Engineer, AI-Engineer); **revisado em 2026-09-23: Opus 5.5 em todos os agentes, exceto o Security-SRE (Fable 5.1) e o Documenter (Haiku 4.5)** (seção "Revisão de 2026-09-23") · **revisado em 2026-10-23 pelo ADR-010: família por alias com piso de versão, `effort` explícito, Planner/Tester/DevOps/Coder em Sonnet 5.5 (Coder escala para Opus em fatia de alto risco) e Security-SRE em Fable ou Opus conforme o plano da assinatura**
**Data:** 2026-07-31
**Decisores:** Tech Lead
**Revisão:** trimestral
**Última revisão:** 2026-10-23

> **Nota (2026-08-04):** este ADR cobre os 9 agentes originais. O quadro atual é de **13 agentes** (1 orchestrator + 12 especialistas); os modelos dos 4 agentes posteriores estão nos ADRs 002 e 003, que seguem o mesmo racional. O quadro consolidado está em `DESENVOLVIMENTO-COM-IA.md §3`.

## Contexto

O fluxo multi-agent tem 9 agentes com custos de erro muito diferentes. A cota de uso dos modelos (plano de subscrição — ⚠️ classe a confirmar, ver a nota em `praticas/00` → IA/LLM) é compartilhada pela equipe, e os modelos disponíveis têm capacidades e custos distintos: **Opus 5.5** e **Fable 5.1** (topo de linha; até 2026-09-23 o topo era só o **Fable 5**), **Sonnet 5** (equilíbrio) e **Haiku 4.5** (rápido e barato).

O gargalo de um fluxo assim não é velocidade de geração de código — é a **qualidade das decisões nos nós de alto impacto**: a decomposição do problema, o design da solução e o gate de review. Um erro nesses nós se propaga (ou passa despercebido) por todo o resto; um erro na execução é barato, porque o Reviewer o intercepta.

## Decisão

Perfil original (2026-07-31): **balanceado, com o modelo de topo nos nós críticos**. Desde 2026-09-23, **Opus 5.5 em todos os agentes da tabela, exceto o Documenter** — ver "Revisão de 2026-09-23". O racional da terceira coluna é o original: explica por que cada papel pedia o que pedia quando havia diferença de modelo.

| Agente | Modelo | Racional |
|---|---|---|
| `orchestrator` | **opus** (`claude-opus-5-5`) | A decomposição e o roteamento definem a qualidade de tudo abaixo |
| `architect` | **opus** (`claude-opus-5-5`) | Decisões de arquitetura são as mais caras de reverter |
| `reviewer` | **opus** (`claude-opus-5-5`) | É o gate obrigatório; um falso "APROVADO" é o erro mais caro do fluxo |
| `planner` | **opus** (`claude-opus-5-5`) — era sonnet | *(racional do sonnet)* Estrutura trabalho sobre design já decidido pelo Architect |
| `coder` | **opus** (`claude-opus-5-5`) — era sonnet | *(racional do sonnet)* Implementa spec fechada; erro é interceptado pelo Reviewer |
| `tester` | **opus** (`claude-opus-5-5`) — era sonnet | *(racional do sonnet)* Critérios de aceitação já definidos; método estruturado |
| `debugger` | **opus** (`claude-opus-5-5`) — era sonnet | *(racional do sonnet)* Segue metodologia científica (skill `engineering:debug`) |
| `devops` | **opus** (`claude-opus-5-5`) — era sonnet | *(racional do sonnet)* Procedural, com checklist pré-deploy |
| `documenter` | **haiku** | Alto volume, insumo já aprovado; menor custo por token |

O `model:` no frontmatter de cada agente (`.claude/agents/*.md`) **prevalece** sobre o `model` do settings global do usuário — a atribuição vale independente da configuração pessoal de cada máquina.

## Alternativas consideradas

1. **Tudo no modelo de topo** — qualidade uniforme máxima, mas consome a cota compartilhada rápido demais em tasks longas; o ganho nos agentes executores é marginal porque eles já trabalham sob spec e sob gate. *(Rejeitada em 2026-07-31; adotada em grande parte na revisão de 2026-09-23 — ver abaixo.)*
2. **Tudo Sonnet** — mais barato, mas degrada exatamente o ponto em que o fluxo deposita confiança: o review. Um gate menos capaz que o coder que ele audita é um gate decorativo.
3. **Haiku nos executores** — economia maior, porém aumenta ciclos de retrabalho Coder↔Reviewer; o custo dos re-reviews no modelo de topo anula a economia.

## Consequências

**Positivas (perfil original):** ~~cota concentrada onde há leverage; gate de review mais confiável que o código que audita~~ — *superado em 2026-09-23, ver as negativas abaixo*; racional documentado e auditável para a equipe.

**Positivas (desde 2026-09-23):** qualidade uniforme em quase todo o fluxo, sem executor mais fraco que o design que implementa; o gate de segurança roda em outra família (Fable 5.1) que a do resto do time.

**Negativas / mitigação:**
- Três modelos para manter atualizados (Opus 5.5, Fable 5.1, Haiku) → revisão trimestral deste ADR. Opus e Fable estão fixados pelo ID e não mudam sozinhos; o Documenter usa o alias `haiku` e acompanha a versão mais nova do Haiku sem passar por aqui.
- **Cota (desde 2026-09-23):** os executores gastam no preço do topo → medir no piloto do `/task`; recuo descrito na "Revisão de 2026-09-23".
- **Reviewer no mesmo modelo do Coder (desde 2026-09-23):** o gate deixa de ser mais capaz que o código que audita e tende a compartilhar os pontos cegos dele → mitigação na "Revisão de 2026-09-23".
- Documenter em Haiku pode ficar aquém em docs complexas → o Orchestrator pode sobrescrever o modelo na delegação quando justificar.

## Nomenclatura dos agentes e visibilidade do modelo

*(decidido em 2026-08-31, Tech Lead)*

Os arquivos em `.claude/agents/` mantêm o **sufixo de modelo** no nome (`reviewer-opus`, `coder-opus`, `security-sre-fable`, `documenter-haiku`, …), enquanto as referências de processo — `ONBOARDING.md`, os campos `agent:`/`next_agent:` do handoff e o corpo do orchestrator — continuam usando o **nome-base** (`reviewer`, `coder`). A separação é deliberada: os hooks e o `artifact_path` dependem do nome-base, e o sufixo existe para tornar o modelo visível já na listagem de agentes.

**Requisito que sustenta a decisão:** em qualquer momento deve estar claro qual modelo está de fato executando. Três camadas garantem isso, e as três precisam continuar existindo:

1. **Frontmatter** — cada agente declara seu `model:` designado.
2. **Auto-verificação** — todo agente tem a seção "Modelo designado (ADR-001)" e confere, no próprio system prompt, em que modelo está rodando. Divergência do designado devolve `status: blocked` com o blocker `"modelo divergente: esperado {X}, rodando em {Y}"` em vez de seguir — o downgrade silencioso vira bloqueio visível.
3. **Ponteiro de handoff** — `model` é campo **obrigatório** (`multi-agents/HANDOFF-PROTOCOL.md` §3.2) e registra o modelo em que o subagente efetivamente rodou, não o designado. É o que fica no `run-log.md` como evidência.

**Custo aceito:** se este ADR trocar o modelo de um agente, o **arquivo mantém o nome-base** (`reviewer.md`, `coder.md`, …) — só o `name:` no frontmatter carrega o sufixo, e é ele que muda. As referências que usam nome-base seguem válidas sem alteração; qualquer menção ao nome sufixado (documentação, scripts) precisa ser atualizada na mesma mudança. Em particular, `.claude/workflows/playbook-task.js` (ADR-005) hard-codeia os `agentType` sufixados (`architect-opus`, `planner-opus`, `spec-writer-opus`, `coder-opus`, `tester-opus`, `reviewer-opus`, `security-sre-fable`) — troca de modelo precisa atualizar esses valores no script junto. A revisão trimestral deste ADR é o momento de verificar isso.

## Revisão de 2026-09-23 — Opus 5.5 em quase todo o time, Fable 5.1 no gate de segurança

*(decidido pelo Tech Lead)*

`orchestrator`, `architect` e `reviewer` passam de **Fable 5** para **Opus 5.5**. O `security-sre` (ADR-002) **fica em Fable**, agora fixado em **Fable 5.1**. *Primeira etapa:* o racional de *onde* fica o modelo de topo não muda — decomposição, design e os dois gates —, muda *qual* modelo ocupa esses nós. Com ela, os dois gates passam a rodar em famílias diferentes: em task sensível, a lente de correção (Reviewer, Opus) e a de segurança (Security-SRE, Fable) não compartilham os pontos cegos de um mesmo modelo. A segunda etapa, mais abaixo, leva o topo também aos executores.

- **ID completo, não alias.** O frontmatter usa `model: claude-opus-5-5` e, no Security-SRE, `model: claude-fable-5-1`. O alias seguiria automaticamente a próxima versão da família — e herdaria a versão exata da conversa principal quando ela já roda naquela família —, o que tira da revisão deste ADR a decisão de trocar o modelo de um gate. Fixar o ID troca conveniência por controle: o upgrade seguinte é uma revisão explícita deste ADR, não um efeito colateral.
- **Sufixo segue a família:** `architect-opus`, `reviewer-opus`; `security-sre-fable` não muda de nome. O `orchestrator` continua sem sufixo. O campo `model` do ponteiro de handoff passa a registrar o ID exato (`claude-opus-5-5`, `claude-fable-5-1`).
- **Auto-verificação:** cada agente confere se roda na versão designada (Opus 5.5; Fable 5.1 no Security-SRE); outra versão ou família devolve `status: blocked` com modelo divergente. Sufixo de janela de contexto (`[1m]`) não é outra versão.
- **Mudou junto:** `name:`/`model:` dos três agentes em Opus e o `model:` do Security-SRE; os `agentType` e a descrição do campo `model` no `playbook-task.js`; ADR-002, 003 e 005; `HANDOFF-PROTOCOL` (o campo `model` do ponteiro passa a registrar o ID exato); `ARCHITECTURE`; as tabelas de modelo do `DESENVOLVIMENTO-COM-IA`, do `ONBOARDING`, do `README` e da `praticas/00`; e um payload da suíte em `docs/patches/`.
- **Segunda etapa, no mesmo dia — executores em Opus 5.5.** Por decisão do Tech Lead, os oito agentes em Sonnet 5 (`planner`, `coder`, `tester`, `debugger`, `devops`, `spec-writer`, `data-engineer`, `ai-engineer`) também passam a `claude-opus-5-5`, com sufixo `-opus`. Ficam fora o Security-SRE (Fable 5.1) e o Documenter (Haiku 4.5). Isso adota em grande parte a alternativa 1 ("tudo no modelo de topo"), que este ADR tinha rejeitado. Dois custos ficam registrados:
  - **Cota.** Os executores são os agentes que mais rodam, e passam a gastar no preço do topo. O piloto do `/task` numa task real é onde medir isso. Se a cota não fechar, o recuo natural é devolver ao Sonnet quem trabalha sob spec fechada e sob gate e tem saída mais fácil de conferir: Planner, Tester e DevOps. O Coder fica em Opus porque o código é o que o Reviewer audita, e manter os dois no mesmo nível evita reabrir o ciclo de retrabalho que a alternativa 3 descreve. Debugger, Spec-Writer, Data-Engineer e AI-Engineer ficam em Opus por decisão do Tech Lead. Pelo critério original (ADR-001 e ADR-003: há gate logo depois), eles seriam o segundo passo do recuo, se o primeiro não bastar.
  - **Gate no mesmo modelo que o código que audita.** O racional original era um Reviewer *mais* capaz que o Coder. Agora os dois rodam em Opus 5.5 e tendem a compartilhar pontos cegos. A única verificação fora da família Opus é a lente do Security-SRE (Fable 5.1), em task sensível. O refutador cego (ADR-005) também ajuda, mas por outro mecanismo: ele roda como `reviewer-opus`, no mesmo modelo, e o que o protege da ancoragem é não ler os vereditos anteriores, não a diversidade de modelo. Em task não-sensível, o dev responsável lê o diff antes do ready (`GOVERNANCE.md` §2.2).
- **Sessões abertas:** a definição dos agentes carrega no startup do Claude Code — reinicie as sessões para que os nomes `-opus` e os modelos fixados valham.
- **Evidência antiga não muda:** artifacts em `tasks/` anteriores a esta revisão registram `fable` nos quatro agentes de topo e `sonnet` nos oito executores, porque foi nesses modelos que rodaram.

## Revisão de 2026-10-23 — ADR-010

Decidida pelo Tech Lead e registrada em `docs/ADR-010-familias-e-esforco-por-agente.md`, que tem o racional, as fontes e o patch. Em resumo:

- **"ID completo, não alias" deixa de valer.** O frontmatter declara a família (`opus`, `sonnet`, `haiku`, `fable`), e a autoverificação passa a conferir a família e um piso de versão. O controle sobre trocar o modelo de um gate fica no piso, no ID exato registrado no ponteiro e no recuo por `ANTHROPIC_DEFAULT_*_MODEL`.
- **Executores em Sonnet 5.5:** Planner, Tester, DevOps e Coder. É o recuo que a revisão de 2026-09-23 já previa, e o Coder entra junto com escalada para Opus por fatia. Com isso o Reviewer volta a ser mais forte que o código que audita.
- **Security-SRE pelo plano:** Fable onde o plano o inclui, Opus no Pro e em assento standard (`scripts/plano-assinatura.mjs`).
- **Nomes:** `planner-sonnet`, `tester-sonnet`, `devops-sonnet`, `coder-sonnet`; os arquivos mantêm o nome-base, como manda a seção "Nomenclatura".

## Notas operacionais

- Ajustes de modelo são mudança de governança: alterar frontmatter dos agentes passa pelo Tech Lead (a pasta `.claude/` é guardrail — ver `GOVERNANCE.md §6`).
- Recomenda-se que cada máquina da equipe NÃO use `skipDangerousModePermissionPrompt: true` no settings global do Claude Code — as travas do projeto são a última linha de defesa e não devem ser a única.
