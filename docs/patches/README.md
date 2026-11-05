# Patches em arquivos protegidos

> **Dono:** Tech Lead · **Revisão:** esvaziar conforme aplicado — patch pendente é dívida, não acervo · **Última revisão:** 2026-10-31

Arquivos que agentes não podem escrever (`GOVERNANCE.md` §6.2: `GOVERNANCE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/workflows/`, `.claude/agents/`) chegam aqui prontos e testados, para o **Tech Lead aplicar à mão, no próprio terminal, fora da sessão do agente** — de dentro do Claude Code a própria trava bloqueia a cópia, e é para bloquear.

## Pendente

| Destino | Proposto | O que muda | Prova |
|---|---|---|---|
| `.claude/hooks/telemetry-emit.mjs` | `docs/patches/telemetry-emit.mjs` | **Versão 0.2.1.** A contenção do spool externo é conferida de novo antes de cada escrita da drenagem do spool externo e no watchdog (troca de ancestral por link durante a drenagem ou depois do prazo não escreve fora da raiz; o evento fica no cache). Herdado da 0.2.0: ponteiro de checkpoint (`artifact_path` não vazio) no `handoff.pointer` sai sem `status` e com o campo aditivo `checkpoint: true` (v1, mudança aditiva do `evento.schema.json`; no nível `minimal` também, sem `raw`). Herdado da 0.1.0: emissor genérico sem vestígios do consumidor (comentários e a regra de redação de token próprio dele); no Windows e no macOS o caminho do spool externo é comparado com a raiz sem caixa e em NFC; a contenção é conferida de novo logo antes de criar o diretório e com o arquivo aberto (troca de ancestral por link entre o preparo e a gravação manda o evento ao cache). Contrato: campo aditivo `checkpoint` (nota 01 do ADR-008) | `node docs/patches/test-telemetry-emit.mjs docs/patches/telemetry-emit.mjs` 20/20 no Linux em 2026-10-19 (o caso 20 é o checkpoint no `minimal`; mais um em sistema de arquivos sem caixa). Idêntico ao bundle `packages/telemetry-hook/dist/telemetry-emit.mjs` do portal (fatia FIX-HOOK-DRAIN). Instalar a 0.2.1 em `.claude/hooks/` |
| `.claude/workflows/playbook-task.js` | `docs/patches/playbook-task.js` | **ADR-011.** `args.revisao_humana` (`obrigatoria` · `dispensada`; ausente ou desconhecido = obrigatória): com obrigatória, o fluxo aprovado devolve `aguardando_revisao_humana` em vez de `done`. `args.dados_pessoais` (caminho do registro em `docs/autorizacoes/`): eleva a sensível, força a revisão humana e põe a regra de uso no `## Esta task` de todo agente (fora de `RULES`, para manter o prefixo estável do ADR-009). Todo retorno traz `revisao_humana` | `node scripts/test-playbook-task.mjs docs/patches/playbook-task.js` 61/61 em 2026-11-05 (Windows); contra `.claude/workflows/` 53/61 — as 8 falhas são os casos novos |
| `.claude/hooks/check-reviewer-gate.mjs` | `docs/patches/check-reviewer-gate.mjs` | **ADR-011.** No `done`: brief com `Revisão humana: obrigatória` ou `Dados pessoais: autorizados` exige `artifacts/revisao-humana.md` com `APROVADO` na primeira linha e `**Revisor:**` preenchido. Dado pessoal autorizado também exige `security-sre.md` APROVADO (mesmo com `Sensível: não`) e o registro citado no brief, com `**Validade:**` ≥ data do `done` no run-log. O veredito passa a recusar o modelo não preenchido (`APROVADO \| REPROVADO`) | `node docs/patches/test-check-reviewer-gate.mjs docs/patches/check-reviewer-gate.mjs` 35/35 em 2026-11-05 (Windows); contra `.claude/hooks/` 22/35 — as 13 falhas são os bloqueios novos |
| `GOVERNANCE.md` | `docs/patches/GOVERNANCE.proposto.md` | **ADR-011.** §2.2 (revisão do dev conforme o projeto), §3.8 nova (revisão humana por projeto), §6.2 (trava inclui revisão humana e registro), §7.1 e §7.7 nova (dado pessoal autorizado pelo cliente) | `git diff --no-index GOVERNANCE.md docs/patches/GOVERNANCE.proposto.md` |

Os três patches do ADR-011 vão juntos: a skill `/task`, `praticas/00`, `praticas/10` e o modelo do brief já falam a língua nova. Até a aplicação, o script em produção ignora os campos novos e devolve `done` direto, e o hook não confere a revisão humana.

Os três lotes anteriores (travas de 2026-09-23, contrato de telemetria do ADR-008 e orçamento de contexto do ADR-009) foram aplicados em 2026-09-29 — ver "Histórico". As suítes `test-*.mjs` ficam aqui como teste de regressão das travas.

## Como aplicar um patch

Patch novo entra aqui com o arquivo proposto (`<nome>.mjs`, `<arquivo>.proposto.<ext>`), a suíte e uma tabela com destino, o que muda e a prova.

**1. Rodar as suítes** — cada uma contra a versão em produção e contra a proposta. Aplicar só se a proposta fechar 100%: caso de bloqueio falhando significa que o patch afrouxou uma trava.

```bash
node docs/patches/test-<hook>.mjs .claude/hooks/<hook>.mjs
node docs/patches/test-<hook>.mjs docs/patches/<hook>.mjs
node scripts/test-playbook-task.mjs
```

**2. Ler os diffs de texto** — são lei, não código, e ninguém além do Tech Lead os revisa na forma final:

```bash
git diff --no-index GOVERNANCE.md docs/patches/GOVERNANCE.proposto.md
git diff --no-index .claude/settings.json docs/patches/settings.proposto.json
```

Patch de agentes ou do script do `/task`: `git diff --no-index .claude/agents docs/patches/agents` e `git diff --no-index .claude/workflows/playbook-task.js docs/patches/playbook-task.js`.

**3. Copiar** — numa branch, fora do Claude Code, para o destino da tabela do patch.

**4. Fechar o ciclo:** rodar a suíte de novo contra `.claude/hooks/` (tem de dar 100%), apagar daqui os arquivos propostos — as suítes `test-*.mjs` ficam —, registrar a linha no "Histórico" abaixo e **reiniciar as sessões do Claude Code**: hooks e `settings.json` carregam no startup. Depois de reiniciar, confira que os gates continuam disparando (peça na sessão `git push --dry-run --force origin HEAD`: tem de ser bloqueado — e, se passar, o `--dry-run` garante que nada foi enviado).

**Opcional:** para `/task` não pedir aprovação a cada execução em sessão não-interativa, acrescente `Workflow(playbook-task)` em `permissions.allow` do `settings.json`. Em sessão interativa não é necessário.

## Limites conhecidos das travas (não corrigidos, de propósito)

- **Variável de shell esconde o caminho:** `H=.claude/hooks; cp x $H/y` passa. Casar variável exigiria interpretar shell; a trava primária é a branch protection no servidor, e o PR mostra a mudança.
- **`Read` negado não impede `cat .env`** pela ferramenta de shell. O deny cobre a ferramenta de leitura; o que protege o segredo de fato é ele não estar no disco do dev (`praticas/06`) e o `gitleaks` no CI.
- **Escrita na zona protegida por `node -e` / `perl -e` / `ruby -e`** passa (só `python3 -c` está na lista de verbos, como em produção). Incluir os três bloquearia também a *leitura* por essas vias — `node -e` lendo o `settings.json` é uso comum —, e o `protect-guardrails` e o `deny` já cobrem as ferramentas de edição.
- **Heredoc cujo corpo pode ser executado liga o modo conservador:** se o comando, fora dos corpos, tiver um interpretador, uma CLI de banco (`psql`, `mysql`, `sqlite3`…), `eval`/`xargs`/`source` ou um caminho `./…` (`python3 - <<EOF`, `psql <<EOF`, `cat <<EOF | bash`, `cat > s.sh <<EOF … ; sh s.sh`), o corpo é analisado em qualquer posição — e um script que só *mencione* `git push origin main` num comentário é bloqueado. Para gravar documentação, use a ferramenta de escrita ou `cat > arquivo.md <<EOF` num comando que não execute nada.
- **Caminho escondido por escape ou montagem:** `cp x .cla\ude/hooks/y`, verbo vindo de crase (`` `echo cp` x .claude/hooks/y ``) e `git apply` de um patch que só *dentro* toca a zona passam — mesma classe da variável de shell acima.
- **Copiar *da* zona para fora também bloqueia** (`cp .claude/hooks/x.mjs /tmp/`): o verbo e o caminho estão no mesmo comando e a trava não distingue origem de destino. Para ler, use `cat` ou a ferramenta de leitura.
- **Vários heredocs na mesma linha** têm os corpos lidos em sequência, como o shell faz; heredoc aninhado dentro de `$(…)` noutra linha é tratado como texto comum (conservador).

## Manutenção

As suítes são o teste de regressão das travas — toda mudança futura acrescenta o caso novo ao banco e roda tudo contra a versão antiga e a nova antes de aplicar. Caso que deve bloquear e caso que deve passar têm o mesmo peso: guardrail que gera falso positivo é contornado, e guardrail contornado não protege nada.

## Histórico

| Data | Patch | Suíte |
|---|---|---|
| 2026-08-04 | `check-reviewer-gate.mjs`, `block-dangerous-git.mjs`, `settings.json`, `GOVERNANCE.md` | 26 casos |
| 2026-08-31 | `block-dangerous-git.mjs` — casamento por posição de comando, ofuscação por aspas, wrappers, escrita em zona protegida via shell; `GOVERNANCE.md` §7 | 60 casos (38/45 na versão anterior) |
| 2026-09-29 | Três lotes de uma vez. **Travas (2026-09-23):** `block-dangerous-git.mjs` (falsos positivos e onze bypasses; zona protegida estendida a `.claude/workflows/` e `.claude/agents/`), `check-reviewer-gate.mjs` (veredito lido na primeira linha de fato), `protect-guardrails.mjs` (as duas pastas novas), `settings.json` (deny nas pastas novas e em `Read` de `.env`), `GOVERNANCE.md` (fluxo por script, zona protegida). **Telemetria (ADR-008):** `telemetry-emit.mjs` e as entradas dele nos 13 eventos. **Orçamento de contexto (ADR-009):** `context-budget.mjs` e a entrada dele em `PostToolUse` | Contra `.claude/hooks/` depois de copiar: block-dangerous-git 145/145, check-reviewer-gate 14/14, protect-guardrails 22/22, telemetry-emit 19/19, context-budget 17/17, `test-playbook-task` 30/30. Em sessão nova: force push bloqueado; nota `[orçamento de contexto]` e registro em `.claude/context-budget.jsonl` com `seq 1 10000`; spool de telemetria recebendo `session.*`, `tool.*`, `prompt.submit`, `notification` |
| 2026-09-29 | `context-budget.mjs` — mede só o que o modelo lê do resultado (`stdout`/`stderr` no Bash, conteúdo no Read, nada em Write/Edit); a versão anterior contava `bashEditDiff` e o conteúdo do Write e dava falso positivo | 20/20 contra `.claude/hooks/` (17/20 na versão anterior); `scripts/smoke-harness.mjs` 7/7 |
| 2026-10-23 | ADR-010 — 13 agentes (família, effort, piso, nomes -sonnet) e playbook-task.js (agentType -sonnet, escalada do Coder) | test-playbook-task 36/36 contra .claude/workflows/ |
| 2026-10-23 | ADR-010, pendência 8 — `playbook-task.js` chama o Security-SRE com `model: 'opus'` em `pro`, `team-standard` e `enterprise-standard` (plano em `args.plano`); `orchestrator.md` e `security-sre.md` com a troca feita por quem chama. Motivo: o `env` do `settings.local.json` não remapeia o alias `fable` de subagente (máquina Pro, Claude Code 2.1.309, 429 sem gasto) | `test-playbook-task` 44/44 contra `.claude/workflows/`; `test-plano-assinatura` 19/19; em sessão nova, `planner-sonnet` em `claude-sonnet-5-5`, `documenter-haiku` em `claude-haiku-5-5` e `security-sre-fable` com `model: opus` em `claude-opus-5-5`. As suítes de hook seguem 100%, menos `telemetry-emit` 16/18 no Windows (casos 11 e 12, anterior ao ADR-010) |
| 2026-10-31 | ADR-009, adendo — `context-budget.mjs` acha a transcrição de subagente de Workflow (`subagents/workflows/{run}/`; antes `contexto: null` e faixa não lida) e defaults 12/12/20/30 e 80 000; `playbook-task.js` com regra de agrupar chamadas, leitura de artefato por resumo e seção, e um Coder por grupo na rodada 1 de task `complexa` | Contra `.claude/`: context-budget 21/21 (20/21 na versão anterior), `test-playbook-task` 50/50 (47/50 na anterior). Pendente: sessão nova para o hook carregar |
