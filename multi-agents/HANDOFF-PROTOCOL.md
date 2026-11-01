# HANDOFF-PROTOCOL.md — Protocolo de Handoff em Arquivos

> Complemento operacional de `ARCHITECTURE.md`. Define **como** os agentes trocam trabalho na prática.
> Regra de ouro: **artifacts são arquivos no disco, não JSON no contexto.** O Orchestrator nunca carrega o conteúdo bruto de um subagente — só referências leves.
>
> **Dono:** Tech Lead · **Revisão:** semestral, ou a cada mudança no protocolo · **Última revisão:** 2026-09-29

---

## 1. Por que arquivo e não contexto

O mecanismo de subagente devolve ao Orchestrator apenas a **mensagem final** do subagente — ele não persiste nada sozinho. Se o subagente despejar todo o trabalho nessa mensagem, dois anti-padrões do `ARCHITECTURE.md` acontecem na hora:

- **Context bloat** — o contexto do Orchestrator estoura com conteúdo bruto.
- **Telephone game** — informação se deforma a cada repasse.

A correção é forçar a regra: **cada subagente grava seu resultado completo em arquivo e devolve só um ponteiro leve.**

---

## 2. Estrutura de uma task

Toda task de desenvolvimento vive em `tasks/{task_id}/`:

```
tasks/
└── {task_id}/                  # ex: 2026-06-29_auth-jwt
    ├── brief.md                # objetivo, escopo, critérios de sucesso (criado pelo Orchestrator)
    ├── run-log.md              # linha do tempo append-only (observabilidade)
    ├── memory.md               # episodic memory: decisões da sessão
    ├── decisions.md            # decisões HUMANAS: append-only, evidência (§2.1)
    └── artifacts/              # output completo de cada agente
        ├── architect.md
        ├── planner.md
        ├── coder.md
        ├── reviewer.md
        └── ...
```

**`task_id`** = `AAAA-MM-DD_slug-curto` (kebab-case). Único e estável; todos os agentes referenciam o mesmo.

### 2.1. `decisions.md` (decisões humanas)

Registro das respostas humanas da task: pergunta de um ponteiro com `needs_human` (§3.2), escolha entre vereditos numa `divergencia`, aceite de risco (`GOVERNANCE.md` §3.5) e qualquer outra decisão que o fluxo levou a um humano (`docs/ADR-008` §5).

- **Append-only.** Nada é reescrito nem apagado; correção é entrada nova que cita a anterior.
- **Escritor:** o Tech Lead (ou o dev responsável que ele designar), direto ou por ferramenta, ou o Orchestrator transcrevendo a resposta que o humano deu na sessão. Agente nunca registra decisão própria aqui.
- **Evidência:** versionado com a task e retido como os demais arquivos dela (`docs/EVIDENCIAS-E-METRICAS.md` §2). Leva o nome do decisor; nunca dado de cliente.
- Aceite de risco continua precisando chegar ao artifact do Security-SRE: `decisions.md` registra a decisão, não substitui o gate.
- Cada entrada gera uma linha `human_decision` no `run-log.md`, com `ref` = `decisions.md`.

Formato de cada entrada (modelo em `tasks/_TEMPLATE/decisions.md`):

```markdown
## AAAA-MM-DD HH:MM — {pergunta em uma linha}
- **Decisor:** {nome} ({papel}) · **Registrado por:** {tech-lead | orchestrator | ferramenta}
- **Origem:** {agente e artifact, ou ponteiro com needs_human}
- **Opções:** {opções apresentadas}
- **Decisão:** {o que foi decidido}
- **Motivo:** {por quê}
```

---

## 3. Contrato do subagente

Ao terminar, **todo** subagente faz duas coisas:

### 3.1. Grava o artifact completo
Em `tasks/{task_id}/artifacts/{agente}.md`, no formato de saída definido no seu manual (`multi-agents/agents/NN-*.md`). É aqui que vai TODO o conteúdo: código, plano, review, resultado de testes, etc.

### 3.2. Devolve SÓ o ponteiro leve
A mensagem final do subagente ao Orchestrator deve conter **apenas** este bloco — nada de copiar o conteúdo do artifact:

```yaml
agent: coder
model: claude-opus-5-5   # ID exato do modelo em que o agente REALMENTE rodou, não o alias da família (ver ADR-010)
task_id: 2026-06-29_auth-jwt
status: completed        # completed | blocked | needs_review | checkpoint (ADR-009, §7.1)
artifact_path: tasks/2026-06-29_auth-jwt/artifacts/coder.md
files_changed: [src/auth/login.ts, src/auth/jwt.ts]
next_agent: reviewer
context_for_next: "JWT implementado. Revisar validação do token e rate limiting."
blockers: []             # se status=blocked, listar aqui o que trava
skill_candidates: []     # skills existentes usadas e/ou candidatas a criar (ver §6.1)
# opcionais (ADR-007) — omita quando não se aplicam
provider: claude-code    # provedor/runtime em que o agente REALMENTE rodou; ausente = claude-code
needs_human: false       # ou {question: "...", options: ["...", "..."], blocking: true}
```

Campos obrigatórios: `agent`, `model`, `task_id`, `status`, `artifact_path`, `next_agent`, `context_for_next`, `blockers`, `skill_candidates`.

Campos opcionais:
- **`provider`** (string): id do provedor/runtime em que o agente efetivamente rodou. É o mesmo id usado nas listas de roteamento (`docs/ADR-007`), a parte antes do `:` da entrada. Junto com `model`, registra a entrada efetivamente usada. Ausente significa o runtime nativo do fluxo (`claude-code`, ADR-005), que é o caso de um provedor do ADR-001. Quem executa com mais de um provedor exige o campo (ADR-007 §7).
- **`needs_human`** (`boolean` ou `{question, options?, blocking?}`): marca que o blocker exige **decisão humana**. Nesse caso o Orchestrator não re-roteia para outro agente (§4.6): leva a pergunta a um humano. `true` indica que a pergunta está no próprio texto do blocker. No objeto:
  - `question` (string, obrigatória) é a pergunta;
  - `options` (lista de strings) são as respostas sugeridas;
  - `blocking` (boolean, padrão `true`) diz se o fluxo depende da resposta para seguir.

  Com `blocking` verdadeiro, o ponteiro também traz `status: blocked` e ao menos um item em `blockers`. Com `blocking: false`, a pergunta não impede o agente de concluir.

**No fluxo por script** (`/task` → `.claude/workflows/playbook-task.js`, `docs/ADR-005`), este bloco é o JSON Schema `POINTER` do script, validado na chamada: o subagente é obrigado a devolver o objeto completo e o modelo tenta de novo se errar o formato. Ponteiro malformado deixa de existir. `provider` e `needs_human` são propriedades **opcionais** do `POINTER` (`docs/ADR-008` §6): o script as repassa nos `events` do agente e, quando o agente bloqueia, devolve `needs_human` no retorno `blocked` — a sessão principal leva a pergunta ao humano e registra a resposta em `decisions.md` (§2.1). Só o Planner, em task `complexa`, devolve ainda `grupos` (`[{slug, tasks, files}]`, arquivos disjuntos): com mais de um grupo, a rodada 1 roda um Coder por grupo, em sequência, cada um gravando `coder-gNN.md`; a rodada de correção volta a um Coder só, que consolida o diff em `coder.md` (`docs/ADR-009`, adendo 2026-10-31).

**Sobre `agent` e `model`:** `agent` é sempre o **nome-base** (`coder`, `reviewer`, …) — sem sufixo de modelo — porque os hooks e o `artifact_path` dependem dele. `model` é o modelo em que o subagente efetivamente rodou — o **ID exato** lido no próprio system prompt (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`, `claude-haiku-5-5`), não só a família: desde 2026-10-23 (ADR-010) o frontmatter declara a família e um piso de versão, e só o ponteiro registra qual versão de fato rodou. Sufixo de janela de contexto (`claude-opus-5-5[1m]`) é o mesmo modelo — registre como aparece, mas não é divergência. Se estiver fora da família designada ou abaixo do piso (ADR-010), o subagente devolve `status: blocked` com o blocker `"modelo divergente: esperado {X}, rodando em {Y}"` em vez de seguir — assim o downgrade silencioso vira um bloqueio visível no `run-log.md`, não um resultado de qualidade menor passando por aprovado.

---

## 4. O que o Orchestrator faz

1. Cria `tasks/{task_id}/` a partir de `tasks/_TEMPLATE/` e preenche `brief.md`.
2. Ao delegar, passa ao subagente: `task_id`, objetivo, contexto, output esperado, **LIMITES** e próximo agente.
3. Ao receber o ponteiro, lê **somente** `status`, `blockers` e `context_for_next`. Só abre o `artifact_path` se precisar tomar uma decisão de roteamento.
4. Anexa uma linha ao `run-log.md` a cada handoff (ver §5).
5. **Não marca a task como `done` sem `artifacts/reviewer.md` presente** (quality gate — `GOVERNANCE.md §3`). Task sensível (auth, dados pessoais, dinheiro, superfície externa, infra) exige também `artifacts/security-sre.md` com veredito `APROVADO`.
6. Em `blocker`, re-roteia para o agente capaz de resolver — não tenta resolver sozinho.
7. **Convergência do retrabalho (ADR-005, P2).** REPROVADO volta ao Coder **uma** vez, com os issues priorizados. Na **segunda** reprovação o problema deixou de ser implementação: o fluxo devolve `escalado` ao Architect, que decide se o problema é de spec/design (refaz) ou de tamanho (manda ao Planner fatiar). A terceira decisão é do Tech Lead. O script `playbook-task.js` aplica este teto por código (`MAX_ROUNDS = 2`).
8. **Divergência é decisão humana.** Em task sensível, após a aprovação em três lentes, um refutador cego (que não lê os vereditos anteriores) tenta derrubar a aprovação. Se discordar, o fluxo devolve `divergencia` e ninguém marca `done` até um humano decidir — o objetivo é impedir que o review vire carimbo sem esperar a métrica M3 trimestral.

---

## 5. run-log.md (observabilidade)

Append-only. Uma linha por evento, formato:

```
| timestamp           | agent     | event      | status       | ref                              |
|---------------------|-----------|------------|--------------|----------------------------------|
| 2026-06-29 14:02    | architect | completed  | needs_review | artifacts/architect.md           |
| 2026-06-29 14:10    | coder     | started    | -            | -                                |
| 2026-06-29 14:38    | coder     | blocked    | blocked      | artifacts/coder.md (ver blocker) |
```

Isso materializa a seção "Observabilidade" do `ARCHITECTURE.md`: quem rodou, quando, com que status.

---

## 6. Fluxo enxuto (default)

Não acione os 13 agentes por reflexo. Escale o esforço à complexidade (`ARCHITECTURE.md` → Scaling de Esforço).

**O script `playbook-task.js` executa as linhas Trivial, Simples/Média/Complexa, SDD, Sensível e Épica desta tabela** (`docs/ADR-005`); Data-Engineer, AI-Engineer, DevOps, Documenter e Debugger continuam sendo acionados pela sessão principal nos seus gatilhos — o script não os chama. A coluna *Complexidade* vem do **recon** — o Architect em modo levantamento, que lê o código antes de qualquer roteamento — e não do enunciado da task. *Sensível* é OR entre o flag do `brief.md` e o recon: o brief pode marcar, o recon pode elevar, nenhum dos dois rebaixa. Em task sensível a verificação muda de forma (três lentes em paralelo + refutador cego), não só de tamanho.

| Complexidade | Fluxo |
|--------------|-------|
| Trivial (1 linha) | Coder → Reviewer (gate ainda obrigatório) |
| Simples / Média / Complexa | **Plan** (architect+planner) → Coder ∥ Tester → Reviewer. No script o Tester roda em paralelo ao Coder em toda task não-trivial; Debugger sob demanda |
| Feature não-trivial (SDD) | **Spec-Writer** antes do Architect |
| Camada de dados como foco | + **Data-Engineer** entre Architect e Planner |
| Subsistema de IA/LLM | + **AI-Engineer** (com Tester rodando as evals) |
| Sensível (auth, dados pessoais, dinheiro, superfície externa, infra) | Verificação em **três lentes paralelas** (Reviewer ∥ Security-SRE ∥ Tester) com unanimidade + **refutador cego**; em infra, Security-SRE também após o DevOps |
| Épica | **Fatiada, não executada:** o Planner devolve fatias de 200–400 linhas e cada uma vira uma `/task` própria. A task-mãe não recebe código |

Documenter e DevOps entram só quando a task pede docs ou infra; Spec-Writer, Data-Engineer, AI-Engineer e Security-SRE só nos seus gatilhos acima.

---

## 6.1. Skills no fluxo (reuso-primeiro)

Governança completa em `SKILLS-GOVERNANCE.md`. No handoff:

- **Reuso primeiro:** Architect/Planner checam as 3 camadas (instaladas → playbook → projeto) e marcam no artifact qual skill o Coder deve usar.
- **Candidate, não criação:** procedimento novo e recorrente (regra dos 3) vira um *skill candidate* registrado na seção `## Skill Candidates` do **próprio artifact** do agente que o detectou (respeitando o escritor único de `GOVERNANCE.md §4.3`) e listado no campo `skill_candidates` do ponteiro. Se houver candidates, o **Orchestrator** consolida em `tasks/{task_id}/artifacts/skill-candidates.md` (arquivo de escrita exclusiva dele, como `brief.md` e `run-log.md`). Nenhum agente cria skill no meio da task.
- **Gate:** o Orchestrator decide; se aprovado, o `documenter` autora via `skill-creator`, nascendo no projeto.
- O campo `skill_candidates` do ponteiro lista o que foi usado e/ou proposto.

---

## 7. Paralelismo seguro (anti-conflito de sync)

`GOVERNANCE.md §4` alerta para conflito de escrita simultânea em pastas sincronizadas (OneDrive/Drive). Para Coders em paralelo:

- Cada Coder paralelo trabalha em **git worktree próprio** (`isolation: worktree`) ou em módulos com **um dono por arquivo**.
- Commits frequentes; merge/review antes de integrar.
- Nunca dois agentes escrevendo o mesmo arquivo ao mesmo tempo.

- **Teto de agentes simultâneos:** `paralelismo_max_agentes` do perfil do projeto (`praticas/00` → bloco `orcamento-contexto`). Sinal de limite de taxa ou espera longa → reduza o paralelismo em vez de enfileirar mais agentes (`docs/ADR-009`).

### 7.1. Orçamento de contexto (`docs/ADR-009`)

Limiares no bloco `orcamento-contexto` de `praticas/00`. Prática: `praticas/12-disciplina-de-saida-de-ferramenta.md`.

- **Prefixo estável.** A mensagem de delegação começa pelo que não muda (regras, papel) e termina no que muda (task, caminhos, issues, estado). Nada de data, hora, contagem, status ou trecho de run-log antes do conteúdo estável.
- **Instrução imutável durante a execução.** `CLAUDE.md`, `.claude/agents/` e o contexto da fatia não são editados enquanto houver agente rodando que os carregou. Mudança de contexto vira arquivo novo, citado na próxima delegação.
- **Checkpoint de agente.** Executor que atinge o limiar (tool calls da faixa, ou contexto) chega a estado consistente, grava `artifacts/{agente}-checkpoint-NN.md` (modelo em `tasks/_TEMPLATE/artifacts/`) e devolve `status: checkpoint` com `artifact_path` apontando para ele. O Orchestrator delega um agente **novo** do mesmo papel com o brief, o contexto da fatia e o checkpoint. Acima de `checkpoint.max_por_fatia`, a fatia volta ao Planner. O gate continua exigindo o artifact **final** (`reviewer.md`, `security-sre.md`), nunca um checkpoint.
- **Reviewer e Security-SRE não fazem checkpoint.** Estourou o orçamento → sinal de escopo excedido (`escopo_excedido: true` no veredito do script; `status: blocked` no fluxo manual). O Orchestrator divide a revisão. Não é reprovação e não consome rodada.
- **Troca de sessão do Orchestrator.** Em épica ou task com várias ondas: ao fechar cada onda, ou quando a sessão passar de `sessao_orquestrador.contexto_max_tokens`, o que vier primeiro. Com todos os agentes da onda já de volta, o Orchestrator grava `tasks/{task_id}/handoff/sessao-NN.md` (modelo em `tasks/_TEMPLATE/handoff/`): só ponteiros e resumo, até `handoff_max_linhas`. A sessão nova começa por `/task retomar {task_id}`, que lê o handoff mais recente e o brief e abre artifact só sob demanda. `handoff/` é evidência da task, como `artifacts/`.

---

## 8. Checklist rápido (cole no início de cada run)

- [ ] `task_id` definido e `tasks/{task_id}/` criado a partir do `_TEMPLATE`
- [ ] `brief.md` preenchido pelo Orchestrator (pela sessão principal, via `/task`)
- [ ] `artifacts/recon.md` existe antes de qualquer roteamento — complexidade e sensibilidade vêm dele
- [ ] Cada subagente grava em `artifacts/{agente}.md` e devolve só o ponteiro
- [ ] `run-log.md` atualizado a cada handoff
- [ ] Paralelismo só em trabalho independente, com worktree/dono único, até `paralelismo_max_agentes`
- [ ] Delegação com prefixo estável; nenhum arquivo de instrução editado com agente rodando
- [ ] Checkpoint → agente novo do mesmo papel; épica/ondas → handoff de sessão (§7.1)
- [ ] Skills checadas (reuso-primeiro); candidates registrados, não criados no meio da task
- [ ] `artifacts/reviewer.md` existe antes de `done`
- [ ] Task sensível → `artifacts/security-sre.md` com `APROVADO` antes de `done`

