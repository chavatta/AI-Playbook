# SKILLS-GOVERNANCE.md — Governança de Skills no Fluxo Multi-Agent

> Complemento de `ARCHITECTURE.md` e `HANDOFF-PROTOCOL.md`. Define **quando** reutilizar uma skill, **quando** criar uma nova, **quem** decide e **onde** ela mora.
> Princípio: **reuso antes de criação; criação só do que já se provou.** Uma skill ruim é pior que nenhuma — ela dispara na hora errada.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## 1. O que é (e o que não é) uma skill aqui

Skill = conhecimento **procedural reutilizável** ("como fazer X neste contexto"), com uma `description` que decide quando ela carrega sozinha.

- **É skill:** procedimento que se repete e tem um jeito certo de ser feito (ex: "adicionar endpoint nesta codebase", "rodar migrations do projeto", "publicar release").
- **NÃO é skill:** decisão única, conhecimento de domínio (isso é doc/ADR), ou algo que só aconteceu uma vez.

---

## 2. Reuso-primeiro — checar 3 camadas, nesta ordem

Antes de qualquer "vamos criar uma skill", o agente verifica se já existe algo que cobre a necessidade:

| Ordem | Camada | Onde | Exemplos |
|-------|--------|------|----------|
| 1 | **Instaladas / externas** | Settings > Capabilities; plugins | `engineering:code-review`, `engineering:debug`, `anthropic-skills:*` |
| 2 | **Playbook (cross-projeto)** | `.claude/skills/` na raiz do playbook | procedimentos reutilizáveis entre projetos |
| 3 | **Projeto** | `<projeto>/.claude/skills/` | procedimentos específicos daquela codebase |

Só passa para "criar" se **nenhuma** das três cobre o caso.

---

## 3. Regra dos 3 — quando criar

Crie uma skill **somente** se TODAS forem verdadeiras:

1. **Repetição provada** — o procedimento já foi feito ~3x, OU é declaradamente um padrão do projeto.
2. **Não coberto** — nenhuma skill das 3 camadas resolve (§2).
3. **Estável** — o jeito certo de fazer não está mudando a cada semana.

Se falhar qualquer uma → **não cria**. Só faz a tarefa e, no máximo, registra um *skill candidate* para reavaliar depois. Isso evita **skill sprawl** (skills mortas, conflitantes, com trigger errado).

---

## 4. Fluxo de detecção e criação

```
Architect/Planner (durante a decomposição)
  └─ checa as 3 camadas (§2)
       ├─ coberto  → USA a skill existente (registra no artifact qual)
       ├─ novo, one-off → só executa, não cria
       └─ novo + repete (regra dos 3) → registra SKILL CANDIDATE
                                          (na seção do próprio artifact + campo
                                           `skill_candidates` do ponteiro; o Orchestrator
                                           consolida em tasks/{id}/artifacts/skill-candidates.md)
                                              │
                          Orchestrator/Tech Lead aprova o candidate (GATE)
                                              │
                          Documenter autora a skill via `skill-creator`
                          (cuida da description = qualidade de trigger)
                                              │
                          Skill nasce no NÍVEL PROJETO por padrão (§5)
```

O agente **nunca cria a skill sozinho no meio da task** — ele registra o candidate e segue. Criação é passo separado, com aprovação.

---

## 5. Onde mora + regra de promoção

- **Default = projeto:** toda skill nova nasce em `<projeto>/.claude/skills/<nome>/SKILL.md`, versionada com o código.
- **Promoção para o playbook:** quando a mesma skill (ou equivalente) provar valor em **mais de um projeto**, promova para `.claude/skills/` na raiz do playbook e remova a duplicata do projeto. Decisão do Tech Lead.
- **Externalização:** se virar algo genérico e maduro, considere transformar em skill instalada (via Settings > Capabilities) — fora do escopo deste fluxo automático.

> Limite operacional: skills **instaladas no Cowork** (Settings > Capabilities) não são editáveis pelos agentes. As camadas **playbook** e **projeto** são arquivos no repo e podem ser criadas/editadas normalmente.

---

## 6. Formato e qualidade

- Toda skill segue `multi-agents/templates/SKILL.template.md`.
- A `description` é o item mais crítico: descreve **quando** usar (triggers claros), não só o que faz. Trigger ruim = skill disparando errado. Use a skill `skill-creator` para escrever/otimizar.
- Skill tem dono e footer de autoria, como qualquer doc do playbook.

---

## 7. Manutenção (evitar skills mortas)

- Em revisões periódicas, skill não usada há muito tempo ou desatualizada é **arquivada ou removida**.
- Skill que conflita/sobrepõe outra → fundir.
- Mudou o procedimento? Atualize a skill na mesma hora — skill desatualizada engana o agente.

---

## 8. Checklist (cole antes de propor uma skill)

- [ ] Checei as 3 camadas e nada cobre (§2)
- [ ] Procedimento já se repetiu ~3x ou é padrão explícito (§3)
- [ ] É procedural e estável (não é decisão única / domínio)
- [ ] Registrei como *skill candidate*, não criei no meio da task
- [ ] Aprovado no gate antes de autorar
- [ ] Nasce no projeto; promove ao playbook só se provar valor em >1 projeto

