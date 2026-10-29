# Evidências e Métricas do Playbook

> Pergunta que este documento responde: **o playbook está funcionando — e como eu provo isso para um auditor?**
>
> Insumo da cláusula 9 (monitoramento e análise crítica) da ISO/IEC 27001 e da ISO/IEC 42001. A análise crítica em si é da direção; o que está aqui é a matéria-prima que este repositório produz.
>
> **Dono:** Tech Lead · **Revisão:** semestral · **Última revisão:** 2026-09-23

---

## 1. O princípio

O playbook já gera evidência como subproduto do trabalho normal: cada task deixa um `run-log.md` com a linha do tempo e um artifact por agente com o veredito. **Isso só vira evidência de auditoria se for versionado, retido e recuperável.** Artefato em disco local, apagado na próxima limpeza, não existe.

Regra prática: **se não está no git, não aconteceu.**

---

## 2. O que é evidência, onde vive e por quanto tempo

| Artefato | Controles que sustenta | Onde | Retenção |
|---|---|---|---|
| `tasks/{id}/brief.md` | 27001 A.8.32 · 42001 A.6.2.2 | Repo do projeto, versionado | 3 anos |
| `tasks/{id}/run-log.md` | 27001 A.8.15 · 42001 A.6.2.8 | Repo do projeto, versionado, **append-only** | 3 anos |
| `tasks/{id}/artifacts/reviewer.md` | 27001 A.8.29, A.5.3 · 42001 A.6.2.4 | Repo do projeto, versionado | 3 anos |
| `tasks/{id}/artifacts/security-sre.md` | 27001 A.8.8, A.8.29 | Repo do projeto, versionado | 3 anos |
| `tasks/{id}/artifacts/impacto-ia.md` | 42001 A.5.2–A.5.5 | Repo do projeto, versionado | 3 anos ou vida do sistema, o que for maior |
| Histórico de PR (revisor, aprovação, checks) | 27001 A.5.3, A.8.32 | GitHub | Vida do repositório |
| `docs/ADR-*.md` | 27001 A.8.27 · 42001 A.6.2.3 | Repo, versionado | Permanente |
| Aceite de risco residual pelo Tech Lead | 27001 A.5.4 · 42001 A.3.2 | No artifact, com nome e data | 3 anos |

**Por que 3 anos:** é um ciclo completo de certificação ISO (auditoria inicial + duas de manutenção). Retenção menor deixa o primeiro ciclo sem lastro.

**Três regras que tornam a evidência utilizável:**

1. **Versione a pasta `tasks/`.** Ela não entra no `.gitignore`. Um `.gitkeep` em `artifacts/` mantém a estrutura em task sem anexo.
2. **Artifact não carrega dado real.** Veredito, referência a `arquivo:linha` e racional — nunca trecho de dado de cliente ou pessoal (`praticas/10-dados-e-contexto-de-ia.md`). Evidência que vaza dado é passivo, não ativo.
3. **Imutabilidade vem do git, não do arquivo.** `run-log.md` é append-only por convenção; o que prova a linha do tempo é o histórico de commits. Reescrever histórico já é proibido pelas travas (`GOVERNANCE.md` §2.3) — essa proibição é também um controle de integridade de log.

---

## 3. Métricas

Poucas e acionáveis. Métrica que ninguém usa para decidir é teatro de conformidade — o mesmo erro de travar pipeline por LOW teórico (`praticas/06`).

| # | Métrica | Como medir | Meta | Cadência |
|---|---|---|---|---|
| **M1** | Cobertura do gate de review | tasks `done` com `**Veredito:** APROVADO` ÷ tasks `done` | **100%** (o hook garante; desvio = trava contornada) | Trimestral |
| **M2** | Cobertura do gate de segurança | tasks sensíveis com `security-sre.md` APROVADO ÷ tasks sensíveis | **100%** | Trimestral |
| **M3** | Taxa de reprovação no review | vereditos REPROVADO ÷ total de vereditos | Sem meta — é **termômetro**. Subiu muito: spec fraca ou task grande. Caiu a zero: review virou carimbo | Trimestral |
| **M4** | Tamanho de PR | linhas alteradas por PR mesclado | ≥80% dentro de 200–400 linhas | Trimestral |
| **M5** | Disparos de trava | execuções bloqueadas por hook, e quantas eram falso positivo | Falso positivo <10% dos disparos | Trimestral |
| **M6** | Exceções autorizadas pelo Tech Lead | contagem + motivo | Tendência decrescente; exceção recorrente = a regra está errada, corrija a regra | Semestral |
| **M7** | Incidentes de dado em contexto de IA | contagem (`praticas/10` §7) | **0**. Qualquer ocorrência dispara análise de causa | Imediato + trimestral |
| **M8** | Cobertura de avaliação de impacto | tasks com gatilho que têm `impacto-ia.md` ÷ tasks com gatilho | **100%** | Semestral |
| **M9** | Eficiência de contexto | custo equivalente por fatia, razão de cache por execução e custo em excesso da seção "Cache quebrado" (`scripts/telemetria/relatorio-custos.mjs`) | Razão de cache ≤ `telemetria.razao_cache_alerta` (`praticas/00`) na maioria das execuções. É termômetro de custo: **nunca** se melhora afrouxando M1–M3 (`docs/ADR-009`) | Trimestral |

### Como extrair (procedimento reprodutível para o auditor)

```bash
# M1 — tasks done sem veredito aprovado do Reviewer (deve retornar vazio)
grep -rLi '^\*\*Veredito:\*\* APROVADO' tasks/*/artifacts/reviewer.md
```

```bash
# M2 — tasks marcadas como sensíveis que não têm artifact do Security-SRE
grep -rl 'Sensível (security gate):\*\* sim' tasks/*/brief.md | sed 's|/brief.md||' | while read t; do [ -f "$t/artifacts/security-sre.md" ] || echo "SEM GATE: $t"; done
```

```bash
# M3 — contagem de vereditos por resultado
grep -rhoi '^\*\*Veredito:\*\* [A-Z ]*' tasks/*/artifacts/reviewer.md | sort | uniq -c
```

```bash
# M4 — tamanho dos PRs mesclados nos últimos 90 dias
gh pr list --state merged --limit 100 --json number,additions,deletions,mergedAt --jq '.[] | "\(.number)\t\(.additions + .deletions)"'
```

```bash
# M9 — custo e cache de uma task (grava tasks/<id>/artifacts/telemetria.md) ou do período
node scripts/telemetria/relatorio-custos.mjs --task <task_id> --gravar
node scripts/telemetria/relatorio-custos.mjs --desde AAAA-MM-DD
```

M5, M6 e M7 não são extraíveis por comando — dependem de registro humano. O Tech Lead mantém a contagem no fechamento trimestral, a partir do que foi reportado (`GOVERNANCE.md` §6.3).

---

## 4. Cadência de revisão dos documentos

Documento sem dono e sem data de revisão é documento morto — e auditor pergunta a data antes do conteúdo.

| Documento | Dono | Cadência |
|---|---|---|
| `GOVERNANCE.md` | Tech Lead | Semestral, ou a cada mudança de trava |
| `DESENVOLVIMENTO-COM-IA.md` | Tech Lead | Semestral |
| `ONBOARDING.md`, `README.md` | Tech Lead | Semestral |
| `multi-agents/ARCHITECTURE.md` | Tech Lead | Semestral |
| `multi-agents/HANDOFF-PROTOCOL.md` | Tech Lead | Semestral, ou a cada mudança no protocolo |
| `multi-agents/SKILLS-GOVERNANCE.md` | Tech Lead | Anual |
| `multi-agents/agents/NN-*` | Tech Lead | A cada mudança de escopo ou de modelo do agente (ADR-001) |
| `docs/ISO-MAPPING.md` | Tech Lead | Semestral, ou a cada mudança no `GOVERNANCE.md` |
| `docs/EVIDENCIAS-E-METRICAS.md` | Tech Lead | Semestral |
| `docs/COMPETENCIA.md` | Tech Lead | Semestral, e a cada entrada ou saída de pessoa |
| `docs/RUNBOOK-INCIDENTE-IA.md` | Tech Lead | Semestral, **e depois de todo incidente real** |
| `praticas/00`, `04`, `05`, `06`, `10`, `11`, `12` | Tech Lead | Trimestral (cloud, ferramentas, segurança e IA giram rápido) |
| `praticas/01`, `02`, `03`, `07`, `08`, `09`, `praticas/README.md` | Tech Lead | Anual |
| `docs/ADR-*` | Autor do ADR | Por evento (ADR-001 e 005 trimestral; 002 a 004 semestral) |
| `multi-agents/templates/` | Tech Lead | Anual |
| `tasks/_TEMPLATE/` | Tech Lead | Anual, ou a cada mudança no protocolo de handoff |
| `scripts/check-pii.sh` | Tech Lead | Trimestral (junto com `praticas/06`) |
| `scripts/telemetria/` (`precos.json` incluso), `scripts/quiet/`, `scripts/smoke-harness.mjs` | Tech Lead | Trimestral, e a cada mudança de preço de modelo ou de versão do Claude Code (rode o `smoke-harness` de novo) — `docs/ADR-009` |
| `.claude/agents/`, `.claude/hooks/` | Tech Lead | A cada mudança de modelo ou de trava. os dois são zona protegida contra escrita por agentes (`.claude/agents/` desde 2026-09-29): mudança chega por `docs/patches/` |
| `.claude/workflows/playbook-task.js`, `.claude/skills/task/`, `scripts/test-playbook-task.mjs` | Tech Lead | A cada mudança no fluxo (ADR-005) — em branch, com o smoke test (`scripts/test-playbook-task.mjs`) rodado e o caso novo acrescentado a ele, como os hooks. `.claude/workflows/` é zona protegida contra escrita por agentes desde 2026-09-29 (mudança chega por `docs/patches/`); `.claude/skills/` segue writável (Documenter autora skills de projeto ali) |
| `docs/patches/` | Tech Lead | Esvaziar conforme aplicado — patch pendente é dívida, não acervo |

**O cabeçalho é a evidência.** Todo documento `.md` da tabela carrega, na abertura, a linha `**Dono:** … · **Revisão:** … · **Última revisão:** AAAA-MM-DD` (os ADRs usam `**Decisores:**` e `**Revisão:**`, que cumprem o mesmo papel). Revisão feita = data atualizada nesse cabeçalho, mesmo que o conteúdo não mude. "Revisado em, sem alterações" é resultado válido e é evidência.

Para achar o que está vencido:

```bash
grep -rn "Última revisão\|\*\*Revisão:\*\*" --include="*.md" . | sort -t: -k3
```

---

## 5. Fechamento trimestral (30 minutos, Tech Lead)

1. Rodar os comandos da §3 e anotar M1–M4.
2. Anotar M5–M7 a partir do que foi reportado no trimestre.
3. Para cada meta não atingida: causa e ação, uma linha cada.
4. Atualizar o status das ações abertas em `docs/ISO-MAPPING.md` §4.
5. Commitar o resultado — o registro do fechamento **é** a evidência da cláusula 9.
