# ADR-009 — Eficiência de contexto e cache

**Status:** Proposto — vira Aceito com o merge do PR pelo Tech Lead; a parte que depende do hook novo vale a partir do patch aplicado (`docs/patches/README.md`); a mudança só vira definitiva depois do plano de medição (§"Como medir")
**Data:** 2026-09-29
**Decisores:** Tech Lead
**Revisão:** depois das 2–3 fatias do plano de medição; depois, trimestral (junto com ADR-001 e ADR-005) e a cada troca de versão do Claude Code (rode `scripts/smoke-harness.mjs` de novo)
**Última revisão:** 2026-09-29
**Relacionado:** complementa o ADR-005 (acrescenta ao `playbook-task.js` checkpoint, teto de paralelismo e prefixo estável, sem mudar roteamento, teto de rodadas nem gates) e o ADR-008 (o relatório de custos lê as transcrições do runtime; não depende do coletor). **Não altera** ADR-001, ADR-002 nem modelo de agente algum. Cria `praticas/12`, a seção "Orçamento de contexto e execução" de `praticas/00` e o §7.1 do `HANDOFF-PROTOCOL.md`. Propõe um hook novo pela zona protegida (`docs/patches/context-budget.mjs`).
**Confiança:** média-alta nos mecanismos (sete verificações no CLI real, suítes verdes); média no efeito, que só o plano de medição confirma.

## Contexto

A telemetria de execuções reais do playbook mostrou um padrão de custo que não vem de modelo nem de gate, e sim de **contexto**:

1. **Escrita e releitura de cache dominam o custo.** Saída é minoria; entrada sem cache é desprezível. Toda chamada ao modelo relê o contexto inteiro — barato por token, caro por volume — e cada quebra de cache reescreve o contexto inteiro no preço de escrita.
2. **Cache quebrando.** O total escrito no cache chegou a várias vezes o contexto final do agente; o saudável é perto de 1×, porque cada token deveria ser escrito uma vez e relido depois. Os piores casos se concentraram em **muitos agentes em paralelo** e **comandos longos** (teste, build, análise estática).
3. **Contexto de agente na casa das centenas de milhares de tokens**, puxado por **resultado de ferramenta** (arquivo lido inteiro, saída completa de teste e linter), não pelo contexto da fatia.
4. **Sessão do orquestrador longa**, relendo tudo a cada turno.
5. **Execuções muito além do teto de tool calls** que o `ARCHITECTURE.md` já define por faixa.

Duas causas mecânicas explicam 2 e 3, e ambas foram confirmadas no runtime:

- **O cache do subagente vive 5 minutos**, contados do início da chamada (transcrições de subagente registram escrita `ephemeral_5m`; a sessão principal, `ephemeral_1h`). Um comando que prende o agente por mais que isso faz a chamada seguinte reescrever o contexto inteiro. Espera por limite de taxa, com muitos agentes em paralelo, tem o mesmo efeito.
- **A releitura cresce com o quadrado do número de chamadas.** Cada chamada relê tudo o que veio antes; um resultado grande lido cedo é relido em todas as chamadas seguintes.

E uma armadilha de medição: **a transcrição grava uma chamada em várias linhas** (uma por bloco de conteúdo), com o mesmo `message.id`, e as primeiras trazem a saída parcial do streaming. Somar linhas multiplica entrada e cache; ler a primeira linha subestima a saída. Qualquer relatório que não deduplique por `message.id` infla a razão de cache e distorce a decomposição.

Restrições: gates, regras de rodada e modelos não mudam (ADR-001, ADR-002, ADR-005); o playbook é genérico — nenhum número deste diagnóstico entra nele; todo limiar vai para o perfil do projeto (`praticas/00`) com default no template; mecanismo de harness só com smoke test.

## Decisão

### 1. Métrica de cache no relatório de custos

`scripts/telemetria/relatorio-custos.mjs` (novo, genérico; preços em `scripts/telemetria/precos.json`) lê as transcrições do Claude Code, **deduplica por `message.id`** ficando com a maior saída de cada chamada, e mostra:

- custo **em dólar** por tipo (entrada, escrita de cache 5 min e 1 h, releitura, saída), total e por sessão;
- por execução (sessão principal e cada subagente): **razão de cache = (entrada + escrita) ÷ contexto final**, marcada acima de `telemetria.razao_cache_alerta` (default 1,5);
- seção **"Cache quebrado"**, ordenada pelo custo em excesso = (escrita − contexto final × `fator_excesso_cache`) × preço de escrita efetivo da execução;
- marca **"saída subestimada pela transcrição"** quando a média é menor que 20 tokens por chamada em execução com mais de 10 chamadas — sem corrigir o número;
- **ganho estimado por papel** de trocar um modelo por outro, repreçando as mesmas contagens. Não há porcentagem fixa: a releitura de cache custa o mesmo em Opus 5.5 e Sonnet 5.5 (US$ 0,20/MTok), então papel dominado por releitura quase não ganha, e papel dominado por saída ganha até 50%. A troca em si continua sendo decisão de ADR (ADR-001);
- com `--task <id> --gravar`, grava `tasks/<id>/artifacts/telemetria.md` — a razão de cache por agente vira artefato da task (métrica M9, `EVIDENCIAS-E-METRICAS.md`).

Nenhum texto do playbook afirmava que trocar Opus por Sonnet corta o custo pela metade; o relatório passa a mostrar o ganho por papel, e a suíte proíbe a afirmação.

### 2. Higiene de cache

- **Prefixo estável.** No `playbook-task.js`, todo prompt começa pelo texto que não muda (regras, disciplina de contexto, papel) e termina no que muda (`## Esta task`: task_id, caminhos, issues da rodada, checkpoint). Agentes do mesmo tipo passam a compartilhar prefixo. Revisão dos hooks de início de sessão e de subagente: o `settings.json` em produção não tem nenhum; o emissor de telemetria proposto (ADR-008) não escreve no stdout no runtime `claude-code`, então não injeta nada no contexto. O hook novo deste ADR só usa `PostToolUse`, cujo `additionalContext` entra **depois** do resultado da ferramenta — no fim, não no prefixo.
- **Instrução imutável durante a execução.** `CLAUDE.md`, `.claude/agents/` e o contexto da fatia não são editados enquanto houver agente rodando que os carregou. Mudança de contexto vira arquivo novo, citado na próxima delegação (`HANDOFF-PROTOCOL` §7.1, `orchestrator.md`, prompt do script).
- **Comando longo.** Duração esperada acima de `comandos_longos.background_acima_segundos` (180 s) roda em background com consulta a cada `polling_segundos` (120 s), ou com timeout explícito; nunca mais de `sem_chamada_max_segundos` (270 s, abaixo dos 5 min do cache) sem chamada ao modelo. Validado no harness (M4, M5).
- **Paralelismo máximo** `paralelismo_max_agentes` (default 4) no perfil. O script roda em lotes quando o fan-out passa do teto; o Orchestrator reduz o paralelismo ao notar limite de taxa em vez de enfileirar mais agentes.

### 3. Disciplina de saída de ferramenta

`praticas/12-disciplina-de-saida-de-ferramenta.md`, referenciada nas definições de Coder, Tester, Debugger, Reviewer e Security-SRE e no prompt de todo agente do script:

- teste, lint e análise estática em modo quiet: wrappers `scripts/quiet/{test,lint,analise}-quiet.mjs` (Node, agnósticos de stack) rodam o comando de `comandos_quiet` do perfil, mostram só falhas e resumo até `quiet_max_linhas` e gravam a saída completa em `tasks/{id}/artifacts/`;
- buscar antes de ler, ler por faixa, nada acima de `leitura_max_linhas_sem_justificativa` (400) sem justificativa;
- nunca log completo, lockfile, gerado, minificado ou binário no contexto;
- saída acima de `saida_para_arquivo_linhas` (150) vai para arquivo e o agente lê o trecho;
- hook `context-budget.mjs` (em produção desde 2026-09-29, com a correção de medição) avisa, **sem bloquear**, quando um resultado passa de `aviso_resultado_tokens` (8 000) e registra o evento em `.claude/context-budget.jsonl` para medir adesão.

### 4. Troca de sessão do orquestrador

- **Quando:** ao fechar cada onda, ou quando o contexto passar de `sessao_orquestrador.contexto_max_tokens` (250 000), o que vier primeiro. O hook avisa o segundo caso (lê o contexto da própria transcrição — M6).
- **Handoff:** `tasks/{id}/handoff/sessao-NN.md`, pelo modelo `tasks/_TEMPLATE/handoff/sessao-NN.md`: estado de cada fatia com ponteiro do último artefato, decisões com link, pendências e bloqueios, próxima ação exata, leituras de cota. Só ponteiros e resumo, até `handoff_max_linhas` (120 ≈ 2 páginas). Só com nenhum agente rodando.
- **Retomada:** o dev faz `/clear` (ou abre `claude` num terminal novo, na raiz do repo) e digita `/task retomar <task_id>`. A skill lê o handoff mais recente e o brief; artefato, só sob demanda.

### 5. Checkpoint de agente

- **Limiar:** tool calls por faixa (`checkpoint.tool_calls_por_faixa`: 12 / 12 / 20 / 30 desde o adendo de 2026-10-31; antes 15 / 15 / 30 / 50) ou contexto acima de `contexto_agente_tokens` (80 000; antes 150 000).
- **Mecanismo:** o agente chega a estado consistente, grava `tasks/{id}/artifacts/{agente}-checkpoint-NN.md` (modelo em `tasks/_TEMPLATE/artifacts/`) e devolve `status: checkpoint` (novo valor do enum do ponteiro, `HANDOFF-PROTOCOL` §3.2). O script delega um agente **novo** do mesmo papel com o mesmo prompt mais o ponteiro do checkpoint; o seguinte não repete leituras já resumidas. Sinal: o hook avisa no limiar (validado dentro de subagente — M3, M7); a regra também está no prompt de todo agente, para o caso de o hook não estar aplicado ou não disparar.
- **Limite:** `checkpoint.max_por_fatia` (3). Acima disso o script devolve `escalado` para o **Planner**: a fatia está grande demais.
- **Reviewer e Security-SRE não usam checkpoint.** Estourou → `escopo_excedido: true` (campo opcional do veredito). O script devolve `blocked` em `review` sem consumir rodada e sem nunca aprovar; a sessão principal divide a revisão.
- **Gate intacto:** o `check-reviewer-gate.mjs` continua exigindo `reviewer.md` (e `security-sre.md`) finais; checkpoint nunca é aprovação.

## Verificações no harness

`scripts/smoke-harness.mjs` roda o CLI oficial em diretório temporário, com hooks de sonda passados por `--settings` (nada do repo muda), no Haiku 4.5. Rodado em 2026-09-29 no Claude Code **2.1.220** (CLI) e de novo, no mesmo dia, com a CLI alinhada à versão do app desktop, **2.1.284**: 7/7 nas duas.

| # | Mecanismo | Resultado | Uso neste ADR |
|---|---|---|---|
| M1 | `PreToolUse` com exit 2 bloqueia e o stderr chega ao modelo | ok | (já usado pelas travas; reconfirmado) |
| M2 | `additionalContext` de `PostToolUse` chega ao modelo na sessão principal | ok | aviso de resultado grande e de troca de sessão |
| M3 | idem dentro de subagente; o hook recebe `agent_id` e `agent_type` | ok | contagem por agente, checkpoint, distinção de gates |
| M4 | Bash com `run_in_background` e leitura posterior da saída | ok | comando longo |
| M5 | Bash com timeout explícito encerra o comando | ok | comando longo |
| M6 | o hook lê o contexto atual na transcrição, da sessão e do subagente, durante a execução | ok | limiar por contexto |
| M7 | o hook `context-budget.mjs` avisa resultado grande e checkpoint no limiar, e o aviso entra no contexto | ok | Frentes 3 e 5 |

M2, M3 e M7 conferem a entrega na **transcrição** da execução, não na resposta do modelo: numa rodada, o Haiku recebeu a nota e não a repetiu. Suítes sem modelo: `docs/patches/test-context-budget.mjs` 20/20 (com os casos da correção de medição); `scripts/test-playbook-task.mjs` 30/30 no script novo (20/30 no anterior — os 10 casos novos); `scripts/telemetria/test-relatorio-custos.mjs` 11/11; `scripts/quiet/test-run-quiet.mjs` 6/6.

**Não validado** (em `docs/PENDENCIAS-TECH-LEAD.md`, com fallback por instrução no prompt): hooks disparando em agentes lançados pela ferramenta **Workflow** (o `playbook-task.js`); background em agente de Workflow; onde ficam as transcrições dos agentes de Workflow.

## Alternativas consideradas

1. **Hook que bloqueia resultado grande ou força o checkpoint.** Descartada: um bloqueio no meio de uma edição deixa o código em estado inconsistente, e bloqueio que gera falso positivo é contornado. O aviso mede adesão sem risco para o gate.
2. **Compactação automática do runtime em vez de checkpoint.** Não resolve: a compactação reescreve o cache inteiro e mantém um agente longo; o checkpoint troca por um agente curto que parte de um resumo que o próprio papel escreveu, em ponto consistente.
3. **Trocar modelos para baixar custo.** Fora do escopo (ADR-001) e de ganho menor do que parece: a releitura custa o mesmo em Opus 5.5 e Sonnet 5.5. O relatório mostra o ganho real por papel para uma decisão futura.
4. **TTL de 1 h nos subagentes.** Não é configurável pelo playbook e dobra o preço da escrita; manter as chamadas a menos de 5 min uma da outra resolve na origem.
5. **Limiares fixos no playbook.** Descartada pela regra de genericidade: stacks e tamanhos de task variam; o playbook dá o default e o projeto ajusta.

## Consequências

**Positivas:** as causas de cache quebrado viram regra verificável (paralelismo, comando longo, prefixo); o contexto de agente passa a ter teto por faixa, com continuação barata; a sessão do orquestrador deixa de carregar a épica inteira; o custo passa a ser medido em dólar, por tipo e por papel, com método que não infla a razão de cache; o gate não muda.

**Negativas / custos:** mais um hook para manter (zona protegida, com suíte); mais handoffs e checkpoints a escrever (texto curto, mas trabalho); checkpoints podem perder nuance entre agentes — mitigado por estado consistente obrigatório, seção "Decisões e armadilhas" no modelo e teto por fatia; o limiar por tool calls é um proxy — o de contexto cobre o caso em que poucas chamadas carregam muito.

## Como medir

Linha de base: as últimas fatias executadas antes desta mudança, medidas com o mesmo relatório (`--task <id>` em cada uma — o método deduplicado vale para a base também, senão a comparação é injusta).

**Plano:** rodar as próximas **2–3 fatias** com as mudanças (patch do hook aplicado e `orcamento` passado ao `/task`) e comparar com a base:

| Métrica | Fonte | Direção esperada |
|---|---|---|
| Custo por fatia (equivalente de API) | `relatorio-custos.mjs --task` | cair |
| Razão de cache por execução, e custo em excesso | idem, seção "Cache quebrado" | cair para perto de 1 |
| Rodadas até APROVADO | `run-log.md` (linhas de REPROVADO antes do APROVADO) | **não subir** |
| Achados CRITICAL/HIGH por fatia | `reviewer.md`, `security-sre.md` | **não subir** |
| Correções que escaparam para a onda seguinte | issues reabertos ou retrabalho citado no handoff/brief da onda seguinte | **não subir** |
| Adesão | `.claude/context-budget.jsonl` (avisos por execução), checkpoints por fatia | avisos caindo entre fatias |

**Regra de decisão:** a mudança só vira definitiva se **nenhuma métrica de qualidade** (rodadas, CRITICAL/HIGH, correções escapadas) piorar. Custo menor com qualidade pior reverte a parte responsável — primeiro os limiares (mais folga), depois o mecanismo. O resultado entra na seção "Revisão" deste ADR com as tasks medidas.

## Adendo 2026-10-31 — releitura de cache

**Medição.** Primeira task real com o fluxo completo (GerenciadorAZ, `2026-10-30_web-gerenciador-vms-nsg-rds` e as seguintes do mesmo dia; 36 subagentes de workflow, transcrições deduplicadas por `message.id`): 16,8 M de releitura. A escrita de cache ficou perto de 1× o contexto final em todos os agentes, ou seja, o cache não quebrou. O custo veio da **releitura**, que é ≈ chamadas × contexto médio:

- dois agentes (Coder e Tester) chegaram a 206k e 168k de contexto e responderam por 3,5 M dos 7 M da primeira task;
- nas execuções seguintes, agentes de 27–32 chamadas com 48–90k de contexto releram 0,7–1,8 M cada;
- spec (573 linhas), plano (514) e design (401) eram lidos inteiros por cada agente seguinte (o Tester leu ~34k tokens deles logo no início e os releu em 14 chamadas).

**Causa do limiar de contexto não disparar.** O `context-budget.mjs` procurava a transcrição só em `{sessão}/subagents/agent-{id}.jsonl`; agente de Workflow grava em `{sessão}/subagents/workflows/{run}/agent-{id}.jsonl`. Sem o arquivo, o hook não lia contexto (`"contexto": null` em todo evento do `context-budget.jsonl`) nem faixa da task (todos caíam na `faixa_padrao`). Só o teto de tool calls valia.

**Decisão.**

1. **Hook acha a transcrição de agente de Workflow** (`transcricaoDoAgente`), e o limiar de contexto cai para **80 000** (`praticas/00`). Patch em `docs/patches/context-budget.mjs`, caso novo na suíte (falha na versão em produção, passa na proposta).
2. **Artefatos de planejamento com teto e índice:** `## Resumo` (até `artefatos.resumo_max_linhas`, 60) e `## Seções por papel`, arquivo até `artefatos.max_linhas` (250); quem lê um artefato de outro papel lê o resumo e a sua seção. Regra no `RULES` do script e no formato dos manuais 01, 02 e 09.
3. **Coder por grupo em task `complexa`:** o Planner devolve `grupos` de arquivos disjuntos (`HANDOFF-PROTOCOL` §3.2); com mais de um, a rodada 1 roda um Coder por grupo, em sequência (`coder-gNN.md`), e o review lê esses artefatos. A rodada de correção volta a um Coder só, que consolida em `coder.md`. Gate, rodadas e modelos não mudam.
4. **Menos chamadas:** teto por faixa 12 / 12 / 20 / 30, e regra no `RULES` de agrupar na mesma resposta as chamadas independentes.

**Estimativa** (simulação sobre os 36 agentes medidos, modelo releitura ≈ Σ contexto por chamada, que reproduz 16,2 M contra 16,8 M reais): só (4) −27%; (1)+(4) −37%; (1)+(2)+(4) −45%; cenário pessimista (lote economiza 10% das chamadas, artefatos tiram 6k) −31%. (3) não foi simulado. Checkpoints a mais reescrevem o prefixo de cada agente novo (~10–13k), bem menos do que a releitura evitada. É estimativa: confirma-se pelo plano de "Como medir" acima, com as mesmas métricas de qualidade como trava.
