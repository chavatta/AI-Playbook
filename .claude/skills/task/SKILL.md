---
name: task
description: >-
  Abre e executa uma task de desenvolvimento pelo fluxo do playbook (recon → plan → coder → review → gate).
  Use quando o dev pedir "/task <slug>" ou "abre uma task para X". Cria tasks/{id}/, preenche o brief e dispara
  o workflow playbook-task. Não use para pergunta, leitura de código ou ajuste de documentação sem código.
---

# /task — abrir e executar uma task pelo fluxo do playbook

> Camada: playbook · Dono: Tech Lead · Executa `.claude/workflows/playbook-task.js` (`docs/ADR-005`)

Você é a **sessão principal**: faz o papel de Orchestrator no que o script não faz — brief, run-log e síntese.
O roteamento, o loop e o gate são do script. Não os refaça à mão.

## Quando usar
- `/task <slug>` ou `/task <slug> — <objetivo em uma frase>`.
- `/task retomar <task_id>` — retomar uma task (épica ou com várias ondas) em sessão nova, a partir do handoff (ver "Retomar").
- Task de código: feature, bug, refactor, infra com arquivo versionado.

## Quando NÃO usar
- Pergunta ou exploração sem mudança de código.
- Mudança só em documentação do playbook (fluxo enxuto manual basta).
- Arquivo protegido (`GOVERNANCE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/workflows/` e `.claude/agents/`): vai para `docs/patches/`.

## Pré-requisitos
- Sessão aberta na raiz do repo (hooks carregam no startup).
- `tasks/_TEMPLATE/` presente.
- Dynamic workflows habilitados (`/config` → Dynamic workflows). Plano pago.
- Plano da assinatura declarado nesta máquina (`node scripts/plano-assinatura.mjs`, `docs/ADR-010`): é ele que decide se o Security-SRE roda em Fable ou em Opus.

## Procedimento

0a. **Confira se o Workflow está liberado** — antes de criar qualquer pasta ou brief. Você não lê o `/config`; o sinal é a ferramenta: se `Workflow` não está entre as suas ferramentas (nem carregável por `ToolSearch`), o Dynamic workflows está desligado.
   - **Ferramenta ausente → pare** e mostre ao dev este alerta, sem criar nada:

     > ⚠️ **/task bloqueada: Dynamic workflows não está habilitado nesta máquina.** Para liberar:
     > 1. Abra o Claude Code **na raiz do repo** e rode `/config`.
     > 2. Ative **Dynamic workflows** (exige plano pago).
     > 3. *(Opcional, recomendado)* peça ao Tech Lead para acrescentar `"allow": ["Workflow(playbook-task)"]` em `permissions` do `.claude/settings.json` (arquivo protegido: `docs/patches/README.md`), ou crie `.claude/settings.local.json` com `{ "permissions": { "allow": ["Workflow(playbook-task)"] } }` só para esta máquina. Sem isso o Claude Code pede aprovação a cada execução.
     > 4. **Feche e reabra o Claude Code** — a configuração só carrega no startup.
     > 5. Na primeira execução, quando pedir aprovação do workflow, escolha **"não perguntar de novo para `playbook-task` neste projeto"**.
     > 6. Rode `/task` de novo.

   - **Ferramenta presente** → siga. Se não houver regra `Workflow(playbook-task)` em `permissions.allow` de `.claude/settings.json` nem de `.claude/settings.local.json`, avise numa linha que o dev vai ver um pedido de aprovação (passo 3 do alerta acima) e continue: é incômodo, não bloqueio.
   - O fluxo manual pelo `orchestrator` só entra se o dev escolher não habilitar, e fica registrado no `run-log.md`.
0b. **Confira o plano da máquina**: `node scripts/plano-assinatura.mjs --verificar`.
   - Saída 0 → siga.
   - Saída 1 (plano não declarado) → pare. Peça ao dev para rodar `node scripts/plano-assinatura.mjs` (com `--assento` em Team/Enterprise e `--plano` se a detecção errar) e reiniciar o Claude Code. Sem isso, o Security-SRE roda em Fable mesmo no Pro, onde o Fable sai em crédito avulso.
   - Saída 3 (gravado, mas a sessão foi aberta antes) → pare e peça para reiniciar o Claude Code: o `env` do settings só carrega no startup.
   - Guarde o plano (`printenv PLAYBOOK_PLANO`): ele vai no `args.plano` do passo 5.
0c. **Confira a versão do playbook**: `node scripts/playbook-update.mjs --verificar`. Nunca bloqueia a task.
   - Saída 0 → siga em silêncio.
   - Saída 10 (GitHub tem versão diferente) → rode `node scripts/playbook-update.mjs --baixar`, diga numa linha quantos arquivos mudaram e onde está o staging (`.playbook-update/<sha7>/CHANGES.txt`), e siga a task. **Não aplique nada**: hook, agente e workflow mudam em branch, com suíte, pelo Tech Lead; arquivo da zona protegida vai marcado `[PROTEGIDO]`. Depois de aplicado, o dev roda `node scripts/playbook-update.mjs --registrar`.
   - Saída 11 (versão nunca registrada) ou 12 (sem rede) → uma linha de aviso e siga.
1. **Monte o `task_id`**: `AAAA-MM-DD_<slug>` — data de hoje via `date +%F`, slug em kebab-case. Se a pasta já existir, pare e pergunte.
2. **Crie a pasta**: copie `tasks/_TEMPLATE/` para `tasks/{task_id}/`, **menos** os dois modelos (`handoff/sessao-NN.md` e `artifacts/agente-checkpoint-NN.md`): eles ficam só no `_TEMPLATE` e são copiados quando usados.
3. **Preencha `brief.md`** com o que o dev disse. Se faltar o **objetivo verificável**, pergunte antes de seguir — é a única pergunta obrigatória. Campos:
   - `Complexidade:` escreva `a definir pelo recon` (o script decide).
   - `Sensível (security gate):` `sim` se o dev disser ou se a classe de dado for Confidencial/Restrita; senão `não`. O recon pode elevar; nunca rebaixa.
   - `Classe de dado:` pergunte se não for óbvio (`praticas/10` §2). Restrita ⇒ não abra a task; escale ao Tech Lead.
   - `Fluxo escolhido:` `playbook-task (workflow)`.
4. **Registre no run-log**: anexe a linha `| <timestamp> | orchestr. | task_created | - | brief.md |`.
5. **Dispare o workflow** com a ferramenta Workflow, por nome, passando `args` como objeto (não como string):
   `{ "name": "playbook-task", "args": { "task_id": "<task_id>", "sensitive": <true|false>, "plano": "<PLAYBOOK_PLANO>", "orcamento": <objeto> } }`
   `plano` decide o modelo do Security-SRE: em `pro`, `team-standard` e `enterprise-standard` o script o chama com `model: 'opus'` (`docs/ADR-010`).
   `orcamento` é o JSON do bloco `orcamento-contexto` de `praticas/00-stack-e-defaults.md`, como objeto — leia só esse bloco (`rg -n -A60 'orcamento-contexto:inicio' praticas/00-stack-e-defaults.md`), não o arquivo inteiro. É dele que saem os limiares de checkpoint, o teto de paralelismo e as regras de comando longo que o script põe no prompt dos agentes (`docs/ADR-009`).
6. **Ao receber o retorno**, anexe ao `run-log.md` uma linha por item de `events` (`| ts | agent | status | - | ref |`). Se o retorno trouxer `sensitive: true` e o brief disser `Sensível (security gate): não`, **troque para `sim`** e acrescente "— elevado pelo recon (artifacts/recon.md)": é o brief que o hook `check-reviewer-gate.mjs` e a métrica M2 leem. Nunca troque de `sim` para `não`. Depois trate o `status`:
   - `done` → anexe `| ts | orchestr. | done | done | artifacts/reviewer.md |` e sintetize (formato do `00-orchestrator.md` → "Formato de Saída"). Item de `events` com `needs_human` (pergunta que não bloqueou o agente) vai ao dev junto com a síntese, e a resposta para `decisions.md` (`HANDOFF-PROTOCOL.md` §2.1).
   - `fatiada` → liste as fatias e diga: "abra uma `/task` por fatia". Não anexe `done`.
   - `escalado` → registre `rerouted → {para}` e apresente os issues (ou o `motivo`) ao dev. Não anexe `done`. `para: planner` significa que a fatia passou de `checkpoint.max_por_fatia` checkpoints: está grande demais e o Planner fatia de novo (`checkpoint` aponta o último).
   - `divergencia` → registre e apresente os dois vereditos ao dev: a decisão é humana. Não anexe `done`.
   - `blocked` com `escopo_excedido: true` (`em: review`) → um gate estourou o orçamento de contexto: não é reprovação e não é `done`. Divida a revisão (grupos de `files_changed`) ou refatie a task; registre e leve ao dev.
   - `blocked` → registre o blocker (`em` diz onde parou) e pare. Se o retorno trouxer `needs_human`, o blocker é uma pergunta para humano: não re-roteie — apresente ao dev a `question` e as `options` (ou o texto do blocker, quando `needs_human: true`), registre a resposta em `decisions.md` e anexe `| ts | orchestr. | human_decision | - | decisions.md |`. `em: lentes`, `em: reviewer` ou `em: refutador cego` significam que um verificador não devolveu veredito — falha de execução, não de código: não é `done` e não conta como reprovação; rode de novo ou leve ao dev.
7. **Checkpoints:** cada item de `events` com status `checkpoint` vira linha no run-log (`| ts | {agente} | checkpoint | checkpoint | artifacts/{agente}-checkpoint-NN.md |`). O retorno traz o total em `checkpoints`.
8. **Épica e várias ondas:** ao fechar cada onda — ou quando o hook avisar que a sessão passou de `sessao_orquestrador.contexto_max_tokens` —, espere os agentes da onda devolverem o ponteiro, grave `tasks/{task_id}/handoff/sessao-NN.md` pelo modelo (só ponteiros e resumo, até `handoff_max_linhas`), anexe `| ts | orchestr. | handoff | - | handoff/sessao-NN.md |` e diga ao dev: **`/clear` e depois `/task retomar {task_id}`**. Nunca grave o handoff com agente rodando.
9. **Nunca escreva `done` sem `artifacts/reviewer.md` com `**Veredito:** APROVADO`** na primeira linha — o hook `check-reviewer-gate.mjs` impede o encerramento da sessão se você o fizer.

## Retomar (`/task retomar <task_id>`)

1. Leia o handoff mais recente de `tasks/{task_id}/handoff/` (maior `NN`) e o `brief.md`. **Só isso.** Artifact, só sob demanda e por faixa.
2. Anexe `| ts | orchestr. | resumed | - | handoff/sessao-NN.md |` ao run-log.
3. Execute a "Próxima ação exata" do handoff. Fatia nova é uma `/task` própria; agente em checkpoint é retomado com o `artifact_path` do checkpoint.
4. Sem handoff na pasta: pare e pergunte — não reconstrua o estado relendo artifacts.

## Exemplo
`/task login-rate-limit — limitar tentativas de login a 5 por minuto por IP`
→ cria `tasks/2026-09-15_login-rate-limit/`, brief com objetivo, `Sensível: sim` (auth), dispara `playbook-task` com `{task_id, sensitive: true}`.

## Armadilhas comuns
- Passar `args` como string JSON: o script recebe texto e falha na validação. Passe objeto.
- Reescrever o `run-log.md` com Write: ele é append-only. Use Edit para anexar.
- Rodar o workflow sem a pasta criada: o recon não acha o brief e devolve `blocked`.
- Achar que `sensitive: false` no brief impede o rigor extra: o recon pode elevar. É OR, por desenho — e o brief tem de refletir a elevação (passo 6).
- Esquecer `orcamento` no `args`: o script segue, mas o prompt dos agentes aponta para o perfil em vez de trazer os números.
- Editar `CLAUDE.md`, `.claude/agents/` ou o contexto da fatia com agente rodando: invalida o cache de quem já carregou. Mudança vira arquivo novo, na próxima delegação.
- Mudar o script sem rodar `node scripts/test-playbook-task.mjs`: o smoke test simula os agentes e cobre todos os status de retorno, sem gastar quota.
