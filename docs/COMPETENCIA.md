# Registro de Competência

> Pergunta que este documento responde: **quem está habilitado a trabalhar sob este playbook, desde quando, e quando isso precisa ser revalidado?**
>
> Atende ISO/IEC 27001:2022 A.6.3 (conscientização, educação e treinamento) e ISO/IEC 42001:2023 A.4.6 (competência das pessoas que operam sistemas de IA). É a ação **4.6** do [`ISO-MAPPING.md`](ISO-MAPPING.md) §4.
>
> **Dono:** Tech Lead · **Revisão:** semestral, e a cada entrada ou saída de pessoa · **Última revisão:** 2026-08-31

---

## 1. Por que um arquivo e não uma planilha

O commit **é** a assinatura. Ele traz autor, data e conteúdo imutável, revisáveis por qualquer pessoa e impossíveis de retroagir sem deixar rastro — três propriedades que uma planilha compartilhada não tem. Vale aqui a mesma regra da [`EVIDENCIAS-E-METRICAS.md`](EVIDENCIAS-E-METRICAS.md): **se não está no git, não aconteceu.**

Regra prática: **a própria pessoa abre o PR que adiciona ou revalida a sua linha.** Registro preenchido por terceiro não é declaração de leitura, é burocracia — e um auditor distingue os dois em trinta segundos.

---

## 2. O que se declara

Ler o playbook não é assistir a um treinamento. A declaração cobre quatro documentos, nesta ordem, e é o mínimo para operar o fluxo:

1. [`DESENVOLVIMENTO-COM-IA.md`](../DESENVOLVIMENTO-COM-IA.md) — por que trabalhamos assim, e os riscos que reconhecemos.
2. [`ONBOARDING.md`](../ONBOARDING.md) — como trabalhar no dia a dia, e os gates que você vai encontrar.
3. [`GOVERNANCE.md`](../GOVERNANCE.md) — a lei: papéis, git, gates, travas, e o §7 sobre dado e evidência.
4. [`praticas/10-dados-e-contexto-de-ia.md`](../praticas/10-dados-e-contexto-de-ia.md) — a única regra sem trava mecânica possível, e por isso a que mais depende de você.

Quem exerce papel de **Tech Lead** ou **Architect** acrescenta [`praticas/00`](../praticas/00-stack-e-defaults.md) e [`praticas/11-mcp.md`](../praticas/11-mcp.md), porque decidem sobre stack e sobre conexão de servidores MCP.

---

## 3. Registro

A coluna **Versão** é o commit de `main` vigente na data da leitura (`git rev-parse --short main`) — sem ela não se sabe *qual* playbook a pessoa leu, e o registro perde valor de evidência.

| Pessoa | Papel | Leu em | Versão (commit) | Revalidar até | PR |
|---|---|---|---|---|---|
| _(preencher — cada pessoa abre o próprio PR)_ | | | | | |

**Revalidação anual**, ou antes disso quando `GOVERNANCE.md` mudar de forma material — mudança de trava, gate novo ou seção nova. Revalidar é reler e atualizar a própria linha, não assinar de novo sem ler.

---

## 4. Saídas

Quem sai da equipe **não é apagado deste arquivo** — a linha ganha data de saída. Evidência histórica é justamente o que o auditor pede: "quem tinha acesso e competência no período X". Apagar destrói o registro do passado para arrumar o presente.

| Pessoa | Papel | Entrou | Saiu |
|---|---|---|---|
| _(vazio)_ | | | |

---

## 5. Como isso é auditado

```bash
git log --format='%an  %ad  %s' --date=short -- docs/COMPETENCIA.md
```

O histórico do arquivo responde sozinho às três perguntas de auditoria: quem declarou, quando, e sobre qual versão do playbook. Não há relatório a gerar.

**Limite honesto:** este registro prova *declaração de leitura*, não *competência demonstrada*. Ninguém é avaliado aqui. Se em algum momento a organização precisar de evidência mais forte — para um cliente com exigência contratual, ou numa certificação —, o passo seguinte é uma verificação prática (um exercício sobre o fluxo, revisado pelo Tech Lead), não um formulário mais longo.
