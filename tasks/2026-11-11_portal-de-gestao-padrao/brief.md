# Brief — 2026-11-11_portal-de-gestao-padrao

**Criado por:** Orchestrator
**Data:** 2026-11-11
**Complexidade:** complexa
**Sensível (security gate):** não — componente local somente leitura em loopback, sem auth, dado pessoal, dinheiro ou superfície externa
**Classe de dado:** Interna
**Dados pessoais:** não
**Revisão humana:** obrigatória
**Avaliação de impacto de IA:** não
**Fluxo escolhido:** fluxo manual (registrado no run-log): pedido do dev com escopo e arquivos já definidos; zona protegida só por patch

## Objetivo (verificável)
Todo projeto que adotar o playbook nasce com o portal de gestão (`gestao/`), com bloqueios resolvíveis, decisões respondidas e telemetria ligada por máquina, e `scripts/test-gestao.mjs` fecha 100%.

## Escopo
- Dentro: `gestao/`, `scripts/test-gestao.mjs`, `--telemetria` no `plano-assinatura.mjs`, `playbook-update` ignora `gestao/projeto.json`, templates (AGENTS, brief, handoff), docs e patches propostos.
- Fora: editar `.claude/settings.json`, hooks, workflows, agents e `GOVERNANCE.md`; registrar tarefa agendada.

## Critérios de sucesso / aceitação
- [x] Portal sobe em projeto vazio e mostra estados vazios
- [x] Testes do portal, plano-assinatura e playbook-update 100%
- [x] Zona protegida intacta; propostas em docs/patches/
