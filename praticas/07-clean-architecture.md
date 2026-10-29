# 07 — Clean Architecture (e parentes: Hexagonal, Onion)

> Pergunta que este documento responde: **como organizar as camadas para que a regra de negócio não dependa de framework, banco ou UI — e quando esse investimento vale a pena?**
>
> Princípio-mãe (a única regra que importa): **dependências apontam para dentro.** O domínio no centro não conhece nada de fora; o mundo externo (web, banco, filas, frameworks) se pluga nele — nunca o contrário.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## O modelo mental

Clean Architecture (Martin), Hexagonal/Ports & Adapters (Cockburn) e Onion (Palermo) são o **mesmo insight** com nomes diferentes:

```
┌──────────────────────────────────────────────┐
│  Infraestrutura (web, DB, filas, SDKs, cron) │  ← detalhes, trocáveis
│  ┌────────────────────────────────────────┐  │
│  │  Adapters (controllers, repositories,  │  │  ← traduzem mundo ↔ domínio
│  │  presenters, gateways)                 │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  Casos de uso (application)      │  │  │  ← orquestram o domínio
│  │  │  ┌────────────────────────────┐  │  │  │
│  │  │  │  Domínio (entidades,       │  │  │  │  ← regra de negócio pura
│  │  │  │  regras, invariantes)      │  │  │  │
│  │  │  └────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         Dependências sempre apontam para DENTRO
```

- **Domínio** — entidades e regras de negócio. Zero imports de framework. Testável sem mock de infra.
- **Casos de uso** — orquestram o domínio para cumprir uma intenção do usuário (`CreateOrder`, `RefundPayment`). Definem **ports** (interfaces) para o que precisam de fora.
- **Adapters** — implementam os ports: repository que fala SQL, controller que fala HTTP, gateway que fala com a API do PSP.
- **Infra** — o framework, o driver, o SDK. Detalhe substituível.

**Teste prático da regra:** o arquivo de regra de negócio importa algo de framework/ORM/HTTP? Se sim, a fronteira vazou.

---

## Quando aplicar por inteiro — e quando não

| Contexto | Recomendação |
|----------|--------------|
| Regra de negócio rica (cálculos, políticas, invariantes, fluxos com estado) | ✅ Camadas completas — o domínio puro paga o custo em testabilidade e evolução |
| Sistema com integração pesada que tende a trocar (PSP, ERP, provedores) | ✅ Ports & adapters nas integrações, mesmo que o resto seja simples |
| CRUD fino sobre banco, pouca regra | ⚠️ Camadas completas viram **cerimônia**: DTO→mapper→entity→mapper→DTO para um SELECT. Use framework idiomático + regra da dependência **onde houver regra** |
| Script, protótipo marcado, ferramenta interna descartável | ❌ Não vale o custo |

> **Meia-regra que sempre vale:** mesmo em CRUD, mantenha duas disciplinas baratas — (1) regra de negócio não vive em controller/handler; (2) acesso a serviço externo passa por uma interface sua. Isso é 80% do benefício por 20% do custo.

## Sinais de que a arquitetura "limpa" degenerou em cerimônia

- Camadas que só repassam chamadas (service → repository 1:1 sem lógica) — módulo raso, ver [02-modularizacao](02-modularizacao.md).
- 4 mappers para cada campo novo (shotgun surgery vertical).
- Interfaces com uma única implementação **e** nenhuma razão de teste/troca — abstração especulativa (YAGNI).
- Ninguém sabe em qual camada colocar código novo → as fronteiras não têm critério, só nomes.

---

## Relação com DDD (estratégico — o "afim" que mais importa)

- **Bounded contexts** definem onde um modelo vale: "Pedido" no contexto de vendas ≠ "Pedido" no contexto de logística. Não force um modelo único global.
- O corte de módulos ([02-modularizacao](02-modularizacao.md)) deve seguir bounded contexts; Clean Architecture organiza **dentro** de cada contexto.
- **Linguagem ubíqua:** o código usa os termos do negócio (`Invoice`, `Settlement`), não sinônimos técnicos inventados.
- DDD tático (aggregates, value objects, domain events) só onde o domínio é rico — no CRUD, é peso morto.

---

## Checklist para o Architect

- [ ] Onde há regra de negócio de verdade? (só lá as camadas completas se pagam)
- [ ] Domínio e casos de uso importam algo de framework/ORM/HTTP? (não podem)
- [ ] Toda integração externa atrás de um port seu?
- [ ] Regra de negócio testável sem subir infra?
- [ ] Alguma camada existe só por cerimônia? (inline-a)
- [ ] Fronteiras seguem bounded contexts do negócio?

---

## Fontes

- Robert C. Martin — *Clean Architecture* (a regra da dependência)
- Alistair Cockburn — [Hexagonal Architecture / Ports & Adapters](https://alistair.cockburn.us/hexagonal-architecture/)
- Eric Evans — *Domain-Driven Design*; Vaughn Vernon — *Implementing DDD* (bounded contexts, linguagem ubíqua)
- Martin Fowler — [PresentationDomainDataLayering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) (camadas na medida)
