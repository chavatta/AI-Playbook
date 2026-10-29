# 03 — Monorepo vs Multi-repo

> Pergunta que este documento responde: **um repositório ou vários — e quando migrar?**
>
> Princípio-mãe: a estrutura de repos segue a estrutura de **acoplamento e de times**, não a moda. Código que muda junto e é revisado pelas mesmas pessoas quer morar junto.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## Decisão rápida

| Situação | Recomendação |
|----------|--------------|
| Equipe pequena (1–2 squads), produto único, código compartilhado | **Monorepo** |
| App + libs internas que versionam juntas | **Monorepo** (workspaces) |
| Serviços com ciclos de vida, stacks e times realmente independentes | **Multi-repo** |
| Cliente/projeto com contrato, acesso ou compliance separado | **Multi-repo** (isolamento de acesso) |
| Open-source de um componente interno | **Multi-repo** (repo público separado) |
| "Vamos fazer microsserviços, então um repo por serviço" | ⚠️ Não decida por reflexo — veja abaixo |

> **Default do playbook: monorepo por produto.** Um repo por produto/domínio; multi-repo entre produtos. Repo ≠ serviço: um monorepo pode deployar N serviços.

---

## Por que monorepo (quando os pontos fortes importam)

- **Mudança atômica cross-módulo** — um PR altera a lib e todos os consumidores de uma vez; sem coordenar releases de 5 repos.
- **Dependências centralizadas** — uma versão de cada lib para todo o produto; fim do "matrix de versões" interno.
- **Refactor barato** — rename/move atravessa tudo com um único review.
- **Visibilidade** — qualquer dev (ou agente) enxerga o todo; onboarding mais simples.
- **CI unificado** — um pipeline, um padrão de qualidade, um lugar para os gates.

**Custos a aceitar:** CI precisa de *path filtering* (buildar/testar só o que mudou); repo cresce (clone/checkout mais lentos com o tempo); controle de acesso é grosso (quem entra, vê tudo).

## Por que multi-repo (quando os pontos fortes importam)

- **Autonomia real de times** — cada repo com seu ciclo de release, tooling e cadência.
- **Isolamento** — acesso, billing, compliance e blast radius separados por repo.
- **Repos pequenos e rápidos** — clone, CI e busca triviais.

**Custos a aceitar:** mudança cross-repo vira dança de N PRs coordenados; dependências internas precisam de registry + versionamento semântico disciplinado; duplicação de config de CI/lint/etc.; visibilidade fragmentada.

---

## Critérios de desempate

1. **Frequência de mudança cross-fronteira.** Se >20% das mudanças tocariam 2+ repos, monorepo. Se quase nunca, multi-repo é viável.
2. **Quem revisa.** Mesmo grupo de reviewers para tudo → monorepo. Times distintos com donos distintos → multi-repo.
3. **Acesso.** Precisa esconder parte do código de parte das pessoas? Multi-repo (é o mecanismo natural de ACL do Git).
4. **Release.** Tudo sobe junto → monorepo. Cadências genuinamente independentes → multi-repo.
5. **Tooling disponível.** Monorepo grande sem tooling (Turborepo/Nx/Bazel, CI com path filtering) vira lentidão; sem apetite para esse tooling, mantenha repos menores.

## Gatilhos de migração

- **Multi-repo → monorepo:** o time passa mais tempo coordenando PRs entre repos do que codando; versões internas divergem e quebram integração.
- **Monorepo → multi-repo (raro):** um componente ganhou time, ciclo e requisitos de acesso próprios (ex.: virou produto/open-source); CI ficou lento **mesmo com** path filtering e cache.

---

## Regras do playbook

- Decisão de estrutura de repo é do **Architect + Tech Lead**, registrada em ADR com os critérios acima.
- Novo projeto segue `GOVERNANCE.md §5` (repo privado, kebab-case, origin de imediato) — a decisão aqui é *quantos* repos, não *como* criá-los.
- Monorepo adota desde o dia 1: workspaces, CI com path filtering, CODEOWNERS por pasta.

---

## Fontes

- [Thoughtworks — Monorepo vs. multi-repo](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/monorepo-vs-multirepo)
- [Spacelift — Monorepo vs. Polyrepo](https://spacelift.io/blog/monorepo-vs-polyrepo)
- [Mintlify — When do you really need a monorepo?](https://www.mintlify.com/blog/when-do-you-really-need-a-monorepo)
- [Kinsta — Monorepo vs Multi-repo: Pros and Cons](https://kinsta.com/blog/monorepo-vs-multi-repo/)
