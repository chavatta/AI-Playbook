# Biblioteca de Boas Práticas

> Referência técnica da equipe. **Não é lei** — a lei é `GOVERNANCE.md`. Aqui vivem os critérios de decisão e padrões de mercado que os agentes e os devs consultam antes de decidir.
>
> Regra de uso: cada prática é **decision-oriented** — diz *quando sim, quando não e por quê*, não só "o que é". Se um documento não ajuda a decidir, ele não pertence a esta pasta.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## Índice

| # | Prática | Pergunta que responde | Consultada principalmente por |
|---|---------|----------------------|-------------------------------|
| 00 | [Stack e Defaults do Projeto](00-stack-e-defaults.md) | Quais são as escolhas-padrão deste projeto? *(por projeto; campo vazio = menu de opções, com "Architect decide" entre elas)* | Todos os agentes |
| 01 | [Clean Code](01-clean-code.md) | Como escrever código que o próximo dev entende? | Coder, Reviewer |
| 02 | [Modularização](02-modularizacao.md) | Onde cortar o sistema em módulos? | Architect, Planner |
| 03 | [Monorepo vs Multi-repo](03-monorepo-vs-multirepo.md) | Um repo ou vários? | Architect, Tech Lead |
| 04 | [Containerização](04-containerizacao.md) | Quando containerizar — e quando não? | Architect, DevOps |
| 05 | [Kubernetes / EKS](05-kubernetes-eks.md) | Quando escalar para orquestração — e quando é overkill? | Architect, DevOps |
| 06 | [DevSecOps](06-devsecops.md) | Como embutir segurança no fluxo sem freá-lo? | Security-SRE, DevOps, Reviewer |
| 07 | [Clean Architecture](07-clean-architecture.md) | Como isolar a regra de negócio de framework/banco/UI — e quando vale? | Architect, Coder |
| 08 | [Design Funcional](08-design-funcional.md) | Como usar princípios funcionais para reduzir bugs, em qualquer linguagem? | Coder, Reviewer |
| 09 | [Testes](09-testes.md) | O que testar, em que nível, e quando um teste vale o custo? | Tester, Coder, Debugger |
| 10 | [Dados e Contexto de IA](10-dados-e-contexto-de-ia.md) | Que informação pode entrar no contexto de um modelo — e sob que condição? | Todos os agentes, Analista/Dev, Security-SRE |
| 11 | [MCP](11-mcp.md) | Que servidores MCP podem ser conectados, sob que condição, e o que muda no risco? | Architect, Security-SRE, DevOps, Tech Lead |
| 12 | [Disciplina de saída de ferramenta](12-disciplina-de-saida-de-ferramenta.md) | O que um agente pode trazer para o próprio contexto, e em que tamanho? | Coder, Tester, Debugger, Reviewer, Security-SRE |

---

## Como os agentes usam esta pasta

- **Todos** — 00 é o ponto de partida: os defaults do projeto vencem preferência de agente; desvio vai para ADR. Campo em branco no 00 não é blocker: o **Architect** apresenta as opções candidatas do campo com uma recomendação, oferecendo também "decida você, Architect"; a escolha vira ADR e o valor volta para o 00.
- **Architect** — consulta 02, 03, 04, 05, 07 ao tomar decisões de design; cita a prática no ADR quando ela fundamenta a decisão.
- **Planner** — usa 02 ao fatiar tasks respeitando fronteiras de módulo (`files_changed` disjuntos).
- **Coder** — segue 01 e 08 como padrão default de escrita, as fronteiras de 07 onde houver regra de negócio, e 09 para os testes que escreve junto com o código; padrões da codebase existente prevalecem em conflito.
- **Tester** — usa 09 como método (pirâmide, FIRST, régua de mocks, cobertura).
- **Debugger** — segue 09 na regra do teste de regressão por bug corrigido.
- **Reviewer** — usa 01 e 08 como régua de manutenibilidade, 09 na dimensão de testes e 06 (camada de código) na dimensão de segurança do diff.
- **DevOps** — usa 04, 05 e 06 (camadas de pipeline e runtime).
- **Security-SRE** — usa 06 como método de auditoria (incl. seções LGPD e segurança de IA) e audita a classificação de 10 no gate de task sensível.
- **Todos, sem exceção** — 10 é a régua do que pode entrar no contexto de um modelo. É a única prática que também é lei (`GOVERNANCE.md` §7).
- **Architect e Security-SRE** — 11 antes de conectar qualquer servidor MCP em escopo de projeto: é mudança de superfície de ataque, com ADR e gate.
- **Coder, Tester, Debugger, Reviewer e Security-SRE** — 12 em toda execução: teste e lint em modo quiet, busca antes de leitura, saída longa em arquivo. Os limiares ficam no 00.

## Manutenção

- Mudança de conteúdo passa pelo Tech Lead (mesma lógica de `GOVERNANCE.md §1`).
- Prática nova entra quando a **regra dos 3** se cumpre: o mesmo critério de decisão foi necessário em 3 tasks diferentes (`multi-agents/SKILLS-GOVERNANCE.md`).
- Cada prática lista as fontes na base. Cadência de revisão: **trimestral** para 00, 04, 05, 06, 10, 11 e 12 (cloud, ferramentas, segurança e IA giram rápido) e **anual** para 01, 02, 03, 07, 08 e 09 (fundamentos estáveis) — ou quando o mercado mudar de consenso.
