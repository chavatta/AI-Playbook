# ADR-012 — Portal de gestão como componente padrão do playbook

**Status:** Proposto — vira Aceito com a aprovação do Tech Lead no PR
**Data:** 2026-11-11
**Decisores:** Tech Lead
**Revisão:** semestral
**Relacionado:** ADR-008 (telemetria: o portal é o consumidor local do spool), ADR-005 (fluxo por script, `run-log.md`), `GOVERNANCE.md` §5.4 e §6.2

## Contexto

O portal nasceu num projeto consumidor (Seta) e provou valor: etapas, bloqueios com o passo a passo de resolução, perguntas aguardando o dev, ADRs, fluxo da execução e custo de tokens num só lugar. Todo projeto que adota o playbook precisa dele, sem copiar e adaptar à mão.

## Decisão

1. `gestao/` entra no playbook: `serve.mjs` (Node ≥ 18, zero dependências, somente leitura, só em 127.0.0.1, porta `GESTAO_PORT`, padrão 4317), `index.html`, launcher único `painel.mjs` (`iniciar`/`parar`/`status`, Node, igual em Windows, macOS e Linux, idempotente, sem tarefa agendada nem alteração de sistema) e wrappers `.ps1`/`.sh` que só o chamam, mais `gestao/README.md` e a suíte `scripts/test-gestao.mjs`.
2. `gestao/projeto.json` é **dado do projeto**: o `playbook-update` não o compara nem o sobrescreve. O playbook entrega o modelo em `gestao/projeto.template.json` (atualizável) e uma cópia inicial em `gestao/projeto.json`. Sem `projeto.json`, o portal o gera do template (ou de um mínimo embutido) e sobe com estados vazios.
3. Regras de comportamento do agente (atualizar `projeto.json` na mesma entrega; pergunta ao dev em vez de opções soltas; bloqueio novo com passo a passo) ficam em `multi-agents/templates/AGENTS.template.md`, e o item "pronto" entra no brief e no handoff.
4. Custo: o portal chama `scripts/telemetria/relatorio-custos.mjs --json` (timeout, cache de ~10 s). Não duplica tabela de preço.
5. Telemetria ligada por padrão **por máquina**, sem tocar na zona protegida: `node scripts/plano-assinatura.mjs --telemetria` grava `PLAYBOOK_TELEMETRY_URL=spool` e `PLAYBOOK_PROJECT_ID` em `.claude/settings.local.json`. O portal lê esse arquivo porque roda fora da sessão e não herda o `env`.
6. Contrato: no `playbook.telemetry/v1`, `agent` é objeto (`{"name": "main"}`); o servidor normaliza para texto e `main` não é subagente.

## Consequências

- Mais um componente com superfície HTTP local: mitigada por bind em loopback, recusa de `Host` estranho (DNS rebinding), só `GET`/`HEAD`, sem servir arquivos arbitrários e escape de HTML em tudo que vem de arquivo.
- Mudança em zona protegida: nenhuma aplicada. Propostas em `docs/patches/`: aviso da telemetria desligada no `/task` (`task-SKILL.proposto.md`) e `gestao/` na lista de adoção do `GOVERNANCE.md` §5.4 (`GOVERNANCE.proposto.md`).
- Rastreabilidade: `projeto.json` é versionado com o projeto; o portal é leitura, não evidência.
