# ADR-005 — Orquestração do fluxo de desenvolvimento por script nativo do Claude Code

**Status:** Aceito — vigência plena depende do patch do GOVERNANCE (`docs/patches/GOVERNANCE.proposto.md`) e do piloto
**Data:** 2026-09-15
**Decisores:** Tech Lead
**Revisão:** trimestral (junto com ADR-001), ou imediatamente se a Anthropic mudar as regras de uso da assinatura
**Última revisão:** 2026-09-23
**Relacionado:** altera `multi-agents/HANDOFF-PROTOCOL.md` §3.2/§4/§6 e `ARCHITECTURE.md`; adiciona uma linha em `praticas/00` (IA/LLM). Não supersede nenhum ADR. O `GOVERNANCE.md` §3.1/§6 é ajustado por patch do Tech Lead (`docs/patches/GOVERNANCE.proposto.md`).

## Contexto

O fluxo multi-agent do playbook (`ARCHITECTURE.md`, fluxos 1–6) era **prosa**: roteamento, paralelismo e gates existiam como instruções que o Orchestrator devia seguir. Quatro falhas estruturais foram identificadas: a complexidade era classificada antes de qualquer agente olhar o código; o loop de retrabalho não tinha teto; o veredito de qualidade era voto único e o Orchestrator estava proibido de conferi-lo; e o Reviewer fazia três trabalhos em fila.

Duas restrições delimitaram a solução:

1. **A equipe continua na assinatura do Claude Code.** A página de legal e compliance do Claude Code reserva o login OAuth ao "uso ordinário do Claude Code e apps nativos" e determina que automação via Agent SDK use API key. Orquestrar o Claude Code por fora — LangGraph, Ruflo, qualquer harness externo — cai na zona que a Anthropic veda ou pode bloquear sem aviso.
2. **A evidência ISO não pode mudar de lugar.** `tasks/{id}/artifacts/*.md` continua sendo o que o auditor lê (`EVIDENCIAS-E-METRICAS.md` §2).

## Decisão

1. **O fluxo obrigatório passa a ser o script `.claude/workflows/playbook-task.js`**, executado pela ferramenta nativa Workflow do Claude Code, disparado pela skill `/task`. Roteamento, teto do loop, forma da verificação e gate são **código**, não instrução.
2. **Recon antes de rotear (P1):** o Architect roda primeiro em "modo levantamento" (escopo, gatilhos de sensibilidade, complexidade real; sem design), com esforço baixo. O script roteia depois.
3. **Convergência do loop (P2):** REPROVADO volta ao Coder uma vez; na segunda reprovação o script devolve `escalado` ao Architect (o problema não é implementação). A decisão seguinte é humana.
4. **Verificação proporcional ao risco (P3/P4):** task sensível — pelo flag do brief **ou** pelo recon — recebe três lentes em paralelo (Reviewer, Security-SRE, Tester) que só aprovam em unanimidade, seguidas de um **refutador cego** que não lê os vereditos anteriores. Task normal mantém voto único.
5. **Épica é fatiada, não executada (P5):** o Planner devolve fatias de 200–400 linhas; cada uma vira uma `/task` própria.
6. **O ponteiro de handoff (§3.2) vira JSON Schema** validado na chamada; ponteiro malformado deixa de existir.
7. **A prosa dos manuais passa a explicar o script, não a competir com ele.** O `00-orchestrator.md` encolhe ao que o script não faz: brief, run-log, síntese.
8. **LangGraph fica no produto.** Não entra no processo. `praticas/00` ganha a linha correspondente.

## Alternativas consideradas

1. **LangGraph orquestrando o Claude Code por fora** (via Agent SDK ou `claude -p`) — determinismo igual, ecossistema conhecido pelo time. Descartado: exige API key para ser conforme (sai da assinatura, muda a cobrança) e, na variante com credencial da assinatura, fere a regra de intermediação de token.
2. **Ruflo (ex-claude-flow)** — harness pronto, 70k stars. Descartado: seu proxy lê `~/.claude/.credentials.json` e reenvia o token OAuth (ADR-313 do projeto), exatamente o que a Anthropic proíbe; `hive-mind` spawna `claude --dangerously-skip-permissions`, anulando o `permissions.deny`; autor único com 99% dos commits; advisory crítica (RCE) em jul/2026; 314 tools MCP e 27 hooks que o `ISO-MAPPING` teria de justificar.
3. **Manter a prosa e só corrigir o texto** (teto do loop, épica) — barato, mas não resolve o roteamento cego nem o voto único, que são estruturais.
4. **Agent teams / subagentes manuais** — o Orchestrator continua decidindo turno a turno; é o modelo que produziu os quatro problemas.

## Consequências

**Positivas:** as quatro falhas estruturais viram propriedades do script; o gate de review deixa de ser declaratório (o `done` só é retornado por código após veredito validado); observabilidade por execução (`/workflows` e `events` no run-log) em vez de grep trimestral; hooks, `permissions.deny`, agentes e evidência ISO permanecem intactos; tudo dentro da assinatura.

**Consequência de trava:** como é o script quem devolve `done`, ele próprio vira alvo a proteger. `.claude/workflows/` e `.claude/agents/` entram na zona protegida contra escrita por agentes (`GOVERNANCE.md` §6.2, patch pendente em `docs/patches/settings.proposto.json`) — sem isso, um agente poderia editar o roteamento ou o próprio veredito que o valida. O script (`playbook-task.js`) hard-codeia os `agentType` sufixados (`architect-opus`, `planner-opus`, `spec-writer-opus`, `coder-opus`, `tester-opus`, `reviewer-opus`, `security-sre-fable`); qualquer troca de modelo (ADR-001) precisa atualizar esses nomes no script na mesma mudança, não só o frontmatter do agente.

**Negativas / custos:** fan-out consome quota da assinatura mais rápido — começar com voto único em task normal e medir; o `00-orchestrator.md` (246 linhas) passa a ser explicação de ~150 linhas de JS, o que é menos legível para auditor e dev novo; `Workflow` exige plano pago e opt-in do usuário a cada run (ou "não perguntar de novo" por projeto); o script não escreve em disco — o run-log continua dependendo da sessão principal.

**Risco aceito:** o fluxo ainda não rodou numa task real. O piloto num projeto com código ainda precisa acontecer; as estimativas de quota são qualitativas até lá.

## Revisão

Trimestral com o ADR-001. Imediata se: a Anthropic alterar a política de uso da assinatura em automação; a ferramenta Workflow mudar de contrato (`meta`, `agent()`, `schema`); ou o piloto mostrar taxa de escalonamento acima de 30% (indica recon fraco ou teto baixo demais).
