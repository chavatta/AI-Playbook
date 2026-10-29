# 05 — Kubernetes / EKS: quando escalar para orquestração

> Pergunta que este documento responde: **quando um workload containerizado justifica Kubernetes (EKS) — e quando é overkill?**
>
> Princípio-mãe: **se você não consegue nomear a capacidade específica do Kubernetes que precisa, você não precisa de Kubernetes.** "É o padrão da indústria" não é requisito.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-08-31

---

## A escada (não pule degraus)

```
1. PaaS / Cloud Run / App Runner      → deploy do container, zero gestão de cluster
2. ECS + Fargate                       → orquestração gerenciada AWS-native, sem nós para operar
3. EKS (managed nodes ou Auto Mode)    → Kubernetes gerenciado; ecossistema K8s completo
4. K8s self-managed                    → só com time de plataforma dedicado e requisito que EKS não atende
```

> Estes degraus detalham os dois últimos da escada canônica do [04-containerizacao](04-containerizacao.md) (container gerenciado → orquestração própria). Notas de 2026: o **EKS Auto Mode** (gerencia nós, autoscaling via Karpenter, CNI e add-ons) reduz bastante o custo operacional clássico do degrau 3 — considere-o o default se EKS se justificar; **EKS on Fargate** perdeu tração e raramente é recomendado para cluster novo; e o **Extended Support** cobra a mais pelo control plane em versão antiga, o que reforça o custo real de upgrade contínuo (janela de suporte padrão: ~14 meses por versão).

A decisão entre degraus se resume a quatro fatores: **posse operacional** (quanta infraestrutura o time quer operar), **perfil do workload** (long-running vs event-driven), **expertise existente** (o time já sabe K8s?) e **trajetória de crescimento** (onde isso estará em 18 meses).

---

## Quando EKS se justifica (motivos reais)

- **Time de plataforma multi-tenant** — uma equipe de plataforma servindo vários times de produto com padrões, quotas e isolamento (namespaces, RBAC).
- **Ecossistema K8s é requisito** — você precisa especificamente de: operators/CRDs, service mesh, GitOps (Argo/Flux), autoscaling custom (KEDA/HPA sobre métricas próprias), scheduling avançado (GPU, spot mix, afinidade).
- **Portabilidade contratual** — requisito real de rodar o mesmo workload em outra cloud/on-prem (não "talvez um dia").
- **Workloads heterogêneos em escala** — dezenas de serviços com perfis distintos onde bin-packing e padronização pagam o custo do cluster.
- **Expertise já existe** — o time opera K8s com fluência; o custo marginal é baixo.

## Quando EKS é overkill (a maioria dos casos)

- **< ~10 serviços e 1–2 squads** — ECS/Fargate ou PaaS entrega o mesmo uptime sem upgrades de cluster, sem add-ons (CNI, CoreDNS, ingress controller), sem RBAC para manter.
- **Ninguém no time opera K8s** — a curva vira taxa permanente: upgrades trimestrais do control plane, versões de add-on, Pod Security Standards (PSS), network policies. Sem dono, isso apodrece.
- **Workload event-driven/burst** — serverless (Lambda/SQS) escala a zero; cluster ocioso é custo fixo.
- **Motivação é currículo ou moda** — resume-driven development. O custo fica com a equipe por anos.

> Referência de mercado: comece em ECS/Fargate por padrão; "gradue" para EKS apenas com uma razão especificamente-Kubernetes nomeável (portabilidade, tooling do ecossistema, time de plataforma multi-tenant). Ambientes maduros normalmente usam **mais de um**: Lambda para o event-driven, ECS para o core, EKS onde há necessidade real de plataforma.

---

## Gatilhos objetivos de migração (revisite a decisão quando…)

- O número de serviços passa de ~10–15 **e** há atrito real de padronização entre eles.
- Surge requisito nomeável do ecossistema K8s (operator de terceiro que você precisa rodar, mesh, GitOps mandatório).
- Nasce um time de plataforma com posse explícita do cluster.
- Multi-cloud/on-prem vira contrato assinado, não hipótese.

Enquanto nenhum gatilho dispara: **fique no degrau atual.**

---

## Se for EKS, mínimos não-negociáveis

- [ ] IaC para cluster e add-ons (Terraform/eksctl) — nada de cluster click-ops (`GOVERNANCE` do DevOps).
- [ ] Upgrades de versão do K8s agendados (EKS força janela de suporte; ~3 releases/ano).
- [ ] IRSA/Pod Identity para IAM por pod — nunca credencial estática em pod.
- [ ] Requests/limits em todo workload; HPA onde fizer sentido.
- [ ] Namespaces + RBAC + network policies desde o dia 1 (ver [06-devsecops](06-devsecops.md)).
- [ ] Observabilidade do cluster (não só das apps): control plane logs, eventos, node health.
- [ ] Custo monitorado por namespace/workload (Kubecost ou equivalente) — cluster esconde desperdício.

---

## Checklist de decisão (para o ADR do Architect)

- [ ] Qual capacidade **especificamente K8s** este workload exige? (nomeie-a; se não conseguir, degrau abaixo)
- [ ] Quem é o dono operacional do cluster? (nome, não "o time")
- [ ] O que o degrau mais simples não atende? (evidência, não intuição)
- [ ] Custo total comparado: cluster (control plane + nós ociosos + tempo de operação) vs alternativa gerenciada.
- [ ] Plano de saída: se em 12 meses o cluster for subutilizado, qual o caminho de volta?

---

## Fontes

- [Cerulean Cloud — When to Use ECS vs EKS vs Lambda: A Decision Framework](https://blog.ceruleancloud.ca/when-to-use-ecs-vs-eks-vs-lambda-a-decision-framework)
- [Sedai — ECS vs EKS: Which AWS Container Platform to Pick?](https://sedai.io/blog/ecs-vs-eks-container-orchestration)
- [InstaDevOps — AWS ECS vs EKS: A Practical Decision Framework for Startups](https://instadevops.com/blog/aws-ecs-vs-eks-comparison/)
- [CloudBolt — ECS vs EKS: A Detailed Comparison](https://www.cloudbolt.io/blog/ecs-vs-eks/)
