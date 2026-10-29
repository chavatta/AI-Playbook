# 09 — Testes

> Pergunta que este documento responde: **o que testar, em que nível, e quando um teste vale o custo de mantê-lo?**
>
> Princípio-mãe: **teste comportamento, não implementação.** Um teste que quebra quando você refatora sem mudar comportamento é um custo, não uma proteção.
>
> Este documento é o método de trabalho do agente **Tester** (`multi-agents/agents/05-tester.md`) e a referência do Coder (que escreve testes junto com o código) e do Debugger (que entrega teste de regressão com cada correção).
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## A pirâmide como orçamento, não como dogma

```
        E2E (~10%)        → fluxos críticos de negócio, poucos e estáveis
     Integração (~20%)    → fronteiras reais: banco, fila, API externa (via testcontainers/fakes)
   Unitários (~70%)       → regra de negócio pura, rápidos (< ms), sem I/O
```

A proporção é um orçamento de manutenção, não uma meta a bater: cada degrau acima custa ~10x mais para escrever, rodar e diagnosticar quando falha. Sistema com regra de negócio isolada (functional core — [08-design-funcional](08-design-funcional.md)) chega perto do 70/20/10 naturalmente; sistema CRUD fino sobre banco pode legitimamente pesar mais em integração.

---

## Critérios de decisão

### O que merece teste (em ordem de retorno)

1. **Regra de negócio com decisão** — cálculo, validação, transição de estado. É onde bugs custam caro e testes são baratos (funções puras).
2. **Contratos entre módulos/serviços** — o que o consumidor espera. Quebra de contrato é o bug mais caro de descobrir tarde.
3. **Edge cases que já morderam** — todo bug corrigido vira teste de regressão (regra do Debugger), senão ele volta.
4. **Caminho de erro** — o que acontece quando a dependência falha, o input é inválido, o timeout estoura. O caminho feliz raramente é onde o sistema cai.
5. **Fluxos críticos E2E** — login, checkout, o fluxo que sustenta o negócio. Poucos, estáveis, com dados próprios.

### O que NÃO merece teste

- Getter/setter, mapeamento trivial, configuração — teste que só repete o código não detecta nada.
- Implementação interna (método privado, ordem de chamadas internas) — teste via comportamento público.
- Framework/biblioteca de terceiro — já é testado por quem o mantém.
- UI pixel-perfect via E2E — frágil e caro; prefira teste de componente.

### Regras FIRST (qualidade de cada teste)

**F**ast (unitário em ms — suíte lenta não roda), **I**ndependent (ordem não importa; sem estado compartilhado), **R**epeatable (mesmo resultado em qualquer máquina — sem depender de rede, relógio ou dado vivo), **S**elf-validating (passa/falha sem inspeção manual), **T**imely (escrito junto com o código, não "depois").

---

## Mocks: a régua

> Mock na fronteira, nunca no meio. Se um teste unitário precisa de 3+ mocks, o problema é o design, não o teste (ver [08-design-funcional](08-design-funcional.md) — a regra está enredada com efeitos).

- **Mocke** o que você não controla: API externa, relógio, aleatoriedade, e-mail/SMS.
- **Não mocke** o que é seu e é puro — chame de verdade.
- **Banco em teste de integração:** instância real efêmera (testcontainers) > fake em memória > mock. SQLite fingindo ser Postgres esconde exatamente os bugs que o teste de integração existe para pegar.
- Dublê que espelha a implementação linha a linha é o pior dos mundos: quebra a cada refactor e não detecta nada.

---

## Cobertura: métrica, não meta

- Cobertura diz o que **não** está testado; não diz que o testado está **bem** testado. 100% com asserts fracos é teatro.
- Uso certo: apontar **buracos em código de decisão** (branch coverage em regra de negócio), não perseguir um número global.
- Meta global de cobertura como gate gera testes escritos para o número (Goodhart). Se houver gate, que seja por diff ("código novo de regra de negócio vem com teste") — verificável pelo Reviewer no PR.

---

## Testes no fluxo multi-agent

| Quem | Responsabilidade de teste |
|------|--------------------------|
| **Planner** | Critérios de aceitação verificáveis no brief — sem eles, o Tester não tem o que validar |
| **Coder** | Testes unitários junto com o código (Timely); roda a suíte antes do handoff |
| **Tester** | Estratégia da suíte, testes de integração/E2E, validação dos critérios de aceitação; **evals** quando há subsistema de IA (golden set, faithfulness — com o AI-Engineer) |
| **Debugger** | Caso de reprodução + teste de regressão entregues com cada diagnóstico |
| **Reviewer** | Verifica no diff: comportamento testado (não implementação), caminho de erro coberto, asserts significativos |

- **Teste falhando → Debugger, não gambiarra.** Apagar/skipar teste que falha sem resolver o que ele detecta é violação de regra inviolável (manual do Debugger).
- Teste **flaky** é bug com prioridade: ou se corrige a causa (espera implícita, estado compartilhado, dependência de ordem) ou se remove — flaky ignorado treina o time a ignorar a suíte inteira.

---

## Checklist (para o artifact do Tester)

- [ ] Todos os critérios de aceitação do brief têm teste correspondente (rastreável 1:1).
- [ ] Caminhos de erro das fronteiras testados (falha de dependência, input inválido, timeout).
- [ ] Todo bug da task virou teste de regressão.
- [ ] Suíte unitária roda em segundos; integração/E2E isoladas e repetíveis.
- [ ] Nenhum teste depende de ordem, rede viva ou dado de produção (LGPD: dado pessoal real nunca entra em fixture — [06-devsecops](06-devsecops.md)).
- [ ] Zero testes skipados/comentados sem issue registrada explicando o porquê.

---

## Fontes

- Kent Beck — *Test-Driven Development: By Example*
- [Martin Fowler — Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) · [Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html)
- [Google — Software Engineering at Google, cap. Testing](https://abseil.io/resources/swe-book/html/ch11.html)
- Michael Feathers — *Working Effectively with Legacy Code* (testes de caracterização)
