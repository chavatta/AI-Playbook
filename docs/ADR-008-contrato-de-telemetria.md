# ADR-008 — Contrato de telemetria: evento `playbook.telemetry/v1`, hook emissor e `decisions.md`

**Status:** Proposto
**Data:** 2026-09-26
**Decisores:** Tech Lead
**Revisão:** a cada mudança do schema (toda mudança vem num ADR novo que complementa este), a cada troca de versão de runtime que mude os eventos de hook, e semestral
**Relacionado:** complementa o ADR-005 (o `run-log.md` e os `events` do script continuam sendo a observabilidade mínima em disco) e o ADR-007 (declara no `POINTER` do `playbook-task.js` os campos opcionais `provider` e `needs_human` que ele acrescentou ao `HANDOFF-PROTOCOL` §3.2). Cria uma exceção estreita ao `GOVERNANCE.md` §7.5 (spool dentro de `tasks/`, ignorado pelo git). Segue o `docs/patches/README.md` para tudo que toca a zona protegida.
**Confiança:** média. A suíte do emissor roda verde e a carga do `settings.proposto.json` foi provada num runtime real, mas o disparo dos eventos de ferramenta com `"matcher": "*"` e o comportamento em versões antigas do runtime ainda são `[VERIFICAR-EMPÍRICO]` (seção "Verificações").

## Contexto

O `multi-agents/ARCHITECTURE.md` (§Observabilidade) pede: qual agente rodou e quando, entradas e saídas de cada handoff, chamadas de ferramenta por agente, blockers e resolução, tempo por agente. Hoje o playbook entrega só uma parte disso:

1. **O `run-log.md` é a linha do tempo mínima.** Tem agente, status e referência por handoff (`HANDOFF-PROTOCOL` §5), montado pela sessão principal a partir dos `events` do script (ADR-005). Não tem chamada de ferramenta, tempo, tokens, subagente nem sessão fora do `/task`.
2. **Cada runtime tem hooks próprios, com nomes e payloads diferentes.** Sem um formato comum, cada painel ou relatório reimplementa a leitura de cada runtime, e o que um mede não se compara com o outro.
3. **O ponteiro não vai a disco.** O `POINTER` é validado na chamada e some; `provider` e `needs_human` (ADR-007) existem no protocolo, mas o schema do script não os declara.
4. **Decisão humana não tem lugar.** A resposta a um `needs_human`, a escolha entre vereditos numa `divergencia` ou um aceite de risco ficam na conversa. O `GOVERNANCE.md` §3.5 manda o aceite de risco para o artifact "com nome e data", mas o artifact é do agente (escritor único, §4.3).
5. **`tasks/` é evidência versionada** (`GOVERNANCE.md` §7.5: "não entra no `.gitignore`"). Um arquivo de fallback local de telemetria dentro da task, se versionado, misturaria dado operacional volumoso com evidência retida por 3 anos.

Restrições que continuam valendo: hook novo e registro no `settings.json` só pela zona protegida (`GOVERNANCE.md` §6, `docs/patches/README.md`); os hooks de gate não podem ser afetados; nenhum dado real de cliente ou pessoal sai da máquina (`praticas/10`); nenhum segredo no repositório (`praticas/06`).

## Decisão

### 1. Contrato do evento

- **Arquivo:** `docs/telemetria/evento.schema.json`, JSON Schema 2020-12, `$id` `urn:playbook-telemetry:evento:v1`, `x-playbook-schema: "playbook.telemetry/v1"`. É a fonte normativa para qualquer emissor ou consumidor. O arquivo é **gerado** (não editado à mão) e chega ao playbook copiado byte a byte; quem gera publica o `sha256` e confere a cópia.
- **Envelope estrito** (`additionalProperties: false`): obrigatórios `schema`, `event_id` (ULID), `ts`, `source`, `type`, `data`; opcionais `project`, `task_id`, `session_id`, `run_id`, `agent`, `provider`, `model`.
- **`data` por tipo, tolerante** (chave desconhecida é preservada, não rejeitada). Os 28 tipos (`session.*`, `prompt.submit`, `tool.*`, `subagent.*`, `handoff.pointer`, `permission.*`, `notification`, `decision.*`, `bus.*`, `progress.report`, `usage.report`, `limit.*`, `flow.step`, `gate.verdict`, `task.indexed`, `run.state`, `compact`, `error`, `alert`) estão enumerados no `oneOf` da raiz.
- **Invariantes fora do JSON Schema** (descritas no próprio arquivo): o tempo do ULID corresponde a `ts` (1 ms de tolerância) e o evento serializado tem no máximo 64 KiB (`data`, 48 KiB).

### 2. Versionamento

- Dentro da v1, só mudança **aditiva e compatível**: campo opcional novo em `data`; valor novo em vocabulário declarado aberto (`notification.kind`, `error.code`, `run.state.reason`, `session.end.reason`); regra nova de classificação ou redação; limite maior.
- **Exige v2:** campo novo, removido ou renomeado no envelope; mudança de tipo ou de semântica; campo obrigatório novo; valor novo em enum fechado (o próprio `type`, `source.kind`, categorias de ferramenta etc.); limite menor.
- A cada major, cópia congelada em `docs/telemetria/v<N>/evento.schema.json`; `docs/telemetria/evento.schema.json` é sempre a versão atual. O consumidor aceita as versões que ainda tiver armazenadas; o emissor novo continua emitindo a versão antiga enquanto houver consumidor que só a aceite. Por isso o consumidor é atualizado **antes** dos hooks.

### 3. Hook emissor

- **Arquivo proposto:** `docs/patches/telemetry-emit.mjs` → `.claude/hooks/telemetry-emit.mjs`. Um arquivo, gerado por build, sem minificar, **sem dependência** (só módulos `node:`), Node ≥ 18. Suíte: `docs/patches/test-telemetry-emit.mjs <emissor>`, script Node sem dependência que sobe um coletor falso em `127.0.0.1`.
- **Desligado por padrão.** Sem `PLAYBOOK_TELEMETRY_URL` (ou com ela vazia) o hook sai em seguida sem ler nada: um projeto que adota o playbook e não tem coletor não muda de comportamento. `PLAYBOOK_TELEMETRY_URL=spool` grava só no spool local, sem rede. O coletor é `https://`; `http://` só vale em loopback. `http://` fora do loopback, URL com usuário ou senha, outro esquema ou URL malformada também degradam para só spool, sem aviso: o token nunca trafega em claro pela rede.
- **Configuração por máquina, nunca no repositório:** `PLAYBOOK_TELEMETRY_URL`, `PLAYBOOK_TELEMETRY_TOKEN` (bearer), `PLAYBOOK_TELEMETRY_DETAIL` (`minimal` | `standard` | `verbose`, padrão `standard`), `PLAYBOOK_TELEMETRY_SCOPE`, `PLAYBOOK_TELEMETRY_DEBUG`, e o contexto opcional de execuções orquestradas `PLAYBOOK_TASK_ID`, `PLAYBOOK_RUN_ID`, `PLAYBOOK_AGENT_ROLE`, `PLAYBOOK_PROJECT_ID`, `PLAYBOOK_TELEMETRY_SPOOL_DIR` e `PLAYBOOK_TELEMETRY_BUS_SERVER`. Tabela completa em `docs/telemetria/README.md`.
- **O que é do orquestrador entra por variável, nunca no código do hook.** O emissor não conhece nome, caminho nem servidor de nenhum orquestrador; quem roda os agentes passa esses dados por duas variáveis:
  - `PLAYBOOK_TELEMETRY_SPOOL_DIR`, com `PLAYBOOK_RUN_ID`: o **spool externo** da execução, em `<dir>/<PLAYBOOK_RUN_ID>.jsonl`. O valor tem de ser um caminho absoluto e normalizado (sem `.`, `..` nem `//`), sem espaço nas pontas e sem caractere de controle. O hook grava no caminho real (links resolvidos) e cria o diretório nível a nível, se faltar. A presença da variável basta para valer a regra, mesmo com valor vazio. Valor inválido, `PLAYBOOK_RUN_ID` ausente ou fora do padrão `run_<ULID>` (o do `run_id` do envelope) ou caminho real na raiz do projeto ou dentro dela ⇒ só o cache do usuário. O spool de uma execução orquestrada não fica dentro do projeto (§4).
  - **Grafia e contenção na gravação:** no Windows e no macOS, cujo sistema de arquivos padrão não distingue caixa, a comparação do caminho real com a raiz real ignora maiúsculas, minúsculas e a forma de normalização Unicode: outra grafia da raiz conta como a raiz. No Linux a comparação é literal. A contenção vale na hora da gravação: o hook confere o caminho real de novo logo antes de criar o diretório e com o arquivo aberto, antes de escrever; se ele mudou (um diretório trocado por link, por exemplo), o evento vai ao cache. Numa troca na janela curta entre a conferência e a abertura, podem sobrar no projeto um diretório e um arquivo vazio, mas nenhum byte de evento. No Windows o separador é `\`: um valor com `/` não está normalizado e vai ao cache.
  - `PLAYBOOK_TELEMETRY_BUS_SERVER`: nome do servidor MCP de barramento do orquestrador. Só as ferramentas **MCP** desse servidor cujo nome está na tabela de barramento recebem `tool_intent` por essa regra. A tabela está publicada em `docs/telemetria/README.md`: `send_message` e `read_inbox` → `message`, `handoff` → `delegate`, `claim_task` → `claim`, `report_progress` → `report`, `request_human_decision` e `permission_prompt` → `ask_human`. Com a variável ausente ou inválida, nenhuma ferramenta MCP recebe `intent` por essa regra, e todas continuam classificadas como MCP comum. A delegação nativa do runtime (`Agent`, `Task`, `Workflow`, `spawn_agent`) continua com `delegate`. O valor é aparado nas pontas; depois disso, começa por letra ou dígito, segue com letras, dígitos e `-`, admite `_` isolado no meio e tem até 64 caracteres.
- **Observar nunca bloqueia.** Sai sempre com 0, não escreve em stderr, e o stdout fica vazio (salvo `{}` onde o runtime exige JSON). Nunca devolve campo de decisão (`permissionDecision`, `decision`, `continue` e afins): não participa de nenhum gate.
- **Prazo rígido de 1,5 s** (1 s no fim de sessão), com disjuntor por coletor: depois de uma falha de rede, 5xx, 408 ou 429, os eventos vão direto ao spool durante uma janela crescente (15 s a 5 min, ou o `Retry-After`), e só uma invocação por janela paga o timeout de rede.
- **Privacidade na origem.** Redação de segredos e caminhos, classificação da ferramenta e truncamento acontecem **antes** de o evento sair ou ir ao spool. No detalhe `standard`, o texto do prompt não sai (só tamanho e hash curto); conteúdo só em `verbose`, por opção explícita.
- **Registro** (`docs/patches/settings.proposto.json`, rebaseado sobre o lote pendente de 2026-09-23): uma **entrada separada** em cada evento (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`), com `node --no-warnings .claude/hooks/telemetry-emit.mjs --runtime=claude-code`, `"timeout": 3` e `"matcher": "*"` nos eventos de ferramenta. Nenhuma entrada existente muda, e o emissor nunca é acoplado aos hooks de gate. **Não** usa `"async"`: o suporte não está confirmado, e chave desconhecida pode invalidar o arquivo inteiro em modo não interativo — o que desligaria os gates junto.

### 4. Spool: operacional, não evidência

| Situação | Arquivo |
|---|---|
| spool externo definido pelo orquestrador (`PLAYBOOK_TELEMETRY_SPOOL_DIR` + `PLAYBOOK_RUN_ID`) | `<dir>/<PLAYBOOK_RUN_ID>.jsonl`, no caminho real, que não fica dentro do projeto (grafia e contenção na gravação no §3). Com a variável presente, as duas linhas seguintes não se aplicam; se o valor for inválido (§3) ou o caminho real cair na raiz do projeto ou dentro dela, o evento vai só para o cache do usuário (última linha) |
| `task_id` conhecido e `tasks/<task_id>/` existe | `tasks/<task_id>/telemetry.jsonl` |
| sem task, e `.claude/` existe e é gravável | `.claude/telemetry-spool.jsonl` |
| nenhum dos dois gravável | cache do usuário (`${XDG_CACHE_HOME:-~/.cache}/playbook-telemetry/`; Windows: `%LOCALAPPDATA%\playbook-telemetry\`) |

- JSONL de eventos **já redigidos**, uma linha por `append`; drenagem por renomeação atômica com lock, reenvio seguro (deduplicação por `event_id`). Limites: 20 MiB descarta os tipos de maior volume, 50 MiB para de gravar e deixa um único `error{code:'spool_full'}`.
- **Exceção ao `GOVERNANCE.md` §7.5:** `tasks/*/telemetry.jsonl*` e `.claude/telemetry-spool.jsonl*` entram no `.gitignore`. O spool é fila de envio, não registro: pode ser apagado depois de entregue, e a evidência da task continua sendo `brief.md`, `run-log.md`, `decisions.md` e `artifacts/`. O padrão é estreito de propósito — nenhum outro arquivo de `tasks/` é ignorado.

### 5. `decisions.md` da task

- Arquivo novo em `tasks/{task_id}/decisions.md` (modelo em `tasks/_TEMPLATE/`), formato em `HANDOFF-PROTOCOL` §2.1.
- **Append-only.** Correção é entrada nova que cita a anterior; nada é reescrito nem apagado.
- **Escritor:** o Tech Lead (ou o dev responsável que ele designar), direto ou por ferramenta, ou o Orchestrator transcrevendo a resposta que o humano deu na sessão. Agente nunca registra decisão própria ali.
- **Evidência:** versionado com a task e retido como os demais arquivos dela (3 anos, `docs/EVIDENCIAS-E-METRICAS.md` §2). Registra o nome do decisor e nada de dado de cliente.
- O aceite de risco continua precisando chegar ao artifact do Security-SRE (`GOVERNANCE.md` §3.5): o `decisions.md` registra a decisão, não substitui o gate.

### 6. Ponteiro no script

O `POINTER` do `.claude/workflows/playbook-task.js` declara `provider` (string) e `needs_human` (`true` ou `{question, options?, blocking?}`) como **opcionais**. O script não muda de roteamento por causa deles: repassa os dois nos `events` do agente e, quando o agente bloqueia, devolve `needs_human` no retorno `blocked`, para a sessão principal levar a pergunta ao humano em vez de re-rotear (`HANDOFF-PROTOCOL` §3.2). O smoke test `scripts/test-playbook-task.mjs` ganhou os casos (20/20 na proposta; 16/20 no script em produção, que não declara os campos).

## Alternativas consideradas

1. **Só o `run-log.md`.** Sem mudança, mas não cobre ferramenta, tempo, tokens nem sessões fora do `/task`, e cada leitor reinterpreta texto livre. Rejeitada.
2. **Um formato por runtime.** Menos trabalho no emissor; cada consumidor reimplementa todos os runtimes e nada se compara. Rejeitada.
3. **Enviar o payload cru do hook e normalizar no coletor.** Emissor trivial, mas o conteúdo (prompt, comando, saída) sai da máquina antes da redação. Fere `praticas/10`. Rejeitada.
4. **Emissor em processo filho destacado** para não pesar no hook. Acrescenta processos órfãos e estados; o custo dominante é a partida do Node, e o disjuntor já limita o pior caso. Rejeitada.
5. **Spool fora de `tasks/`** (só em `.claude/` ou no cache do usuário). Evita a exceção ao §7.5, mas perde a ligação natural evento → task quando a sessão não sabe o `task_id` pelo ambiente. Rejeitada em favor da exceção estreita e declarada.
6. **Ponteiro gravado em disco pelo script.** Resolveria o item 3 do contexto, mas o script não toca disco por desenho (ADR-005). O `handoff.pointer` do contrato cobre o caso pelo hook de fim de subagente. Rejeitada.

## Consequências

**Positivas:** um formato só para qualquer runtime e qualquer consumidor; projeto sem coletor não muda nada; o gate e o fluxo continuam iguais; decisões humanas passam a ter registro versionado; o ponteiro declara onde o agente rodou.

**Negativas / mitigação:**
- **Latência por evento** (~60–90 ms de partida do Node por hook, só quando a URL está configurada). Mitigação: no-op imediato sem URL; disjuntor; prazo rígido.
- **Mais um hook na zona protegida.** Mitigação: suíte própria, entrada separada, nunca sai ≠ 0, nunca decide.
- **Spool dentro de `tasks/`.** Mitigação: padrão de ignore estreito e declarado; redação antes de gravar.
- **Arquivo gerado grande no repositório** (emissor e schema). Mitigação: sem minificar, revisável; a cópia é conferida por `sha256` com o gerador.
- **Evento forjado** por quem tem o token da máquina. Mitigação: observação não é comando — nenhum evento vira decisão, gate ou pausa sem passar pelo fluxo; token por máquina, fora do repositório.

## Verificações

- **Feito:** suíte do emissor verde dentro deste repositório (`node docs/patches/test-telemetry-emit.mjs docs/patches/telemetry-emit.mjs`). Carga do `settings.proposto.json` num runtime real (Claude Code 2.1.229, modo `-p`, `PLAYBOOK_TELEMETRY_URL=spool`): o arquivo com os 13 eventos e os gates do lote pendente foi aceito, e `SessionStart`, `UserPromptSubmit`, `StopFailure` e `SessionEnd` chegaram ao spool como `session.start`, `prompt.submit`, `error{code:'authentication_failed'}` e `session.end`. Na mesma versão, uma chave de evento inexistente acrescentada ao arquivo **não** o invalidou (os mesmos eventos chegaram).
- **`[VERIFICAR-EMPÍRICO]`:** `"matcher": "*"` casando todas as ferramentas (alternativa: `".*"`); disparo dos eventos de ferramenta e de subagente; tolerância de versões antigas do runtime a nomes de evento que elas não conhecem. **Degradação:** evento que não dispara simplesmente não chega; se uma versão antiga rejeitar o arquivo por nome de evento desconhecido, a máquina afetada fica sem as entradas `StopFailure`/`SubagentStart`/`PostToolUseFailure`/`PermissionRequest` até atualizar o runtime — o Tech Lead confere, na aplicação, que os gates continuam disparando em cada máquina (passo 4 do `docs/patches/README.md`).

## Mudanças derivadas quando aceito

Fora deste PR, todas na zona protegida ou 🔒:
- Aplicar `telemetry-emit.mjs` e `settings.proposto.json` pelo procedimento do `docs/patches/README.md`, junto com o lote de 2026-09-23.
- `GOVERNANCE.md` §7.5: citar a exceção do spool (`tasks/*/telemetry.jsonl*`) e este ADR. §4.3: acrescentar `decisions.md` à lista de escritor único (humano ou Orchestrator transcrevendo).
- `docs/EVIDENCIAS-E-METRICAS.md` §2 e `docs/ISO-MAPPING.md`: listar `decisions.md` entre as evidências da task.

## Revisão

A cada mudança do schema (ADR novo que complementa este) e semestral. Revisão imediata se: um runtime mudar nome ou payload de evento de hook; o custo do hook passar de 150 ms por evento com a URL configurada; algum dado não redigido for achado num spool ou no coletor.
