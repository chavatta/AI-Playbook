# 04 — Containerização: quando sim, quando não

> Pergunta que este documento responde: **este workload deve virar container — ou é complexidade desnecessária?**
>
> Princípio-mãe: container resolve **reprodutibilidade e paridade de ambiente**. Se esses não são seus problemas, container é embalagem cara para um problema que você não tem.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-08-31

---

## Quando containerizar (sinais de "sim")

- **Serviço de longa duração** (API, worker, web app) que roda em mais de um ambiente (dev/staging/prod) — paridade de ambiente é o ganho clássico.
- **Dependências de sistema não-triviais** — versões específicas de runtime, libs nativas, binários. A imagem congela tudo.
- **Mais de um serviço na mesma máquina/cluster** — isolamento de dependências e limites de recurso por processo.
- **Time/CI faz deploy frequente** — *build once, deploy many*: o mesmo artefato imutável em staging e prod (manual do DevOps).
- **Onboarding recorrente** — `docker compose up` substitui um dia de setup de máquina.
- **Portabilidade real requerida** — multi-cloud, on-prem + cloud, ou entrega de software para rodar no cliente.

## Quando NÃO containerizar (sinais de "não")

- **Workload event-driven curto** — funções serverless (Lambda/Cloud Functions) têm menos operação que manter imagem + registry + runtime. Container aqui só se o vendor lock-in for inaceitável ou o cold start/limite de runtime doer.
- **Site/app estático ou frontend** — hospedagem estática/CDN (Vercel, S3+CloudFront, Pages) é mais simples e barata.
- **Script/cron simples** — um script com runtime gerenciado (ou serverless agendado) não precisa de imagem.
- **App desktop/CLI distribuído ao usuário final** — empacote nativo.
- **Banco de dados em produção** — prefira o serviço gerenciado (RDS, Cloud SQL…). Container de banco é ótimo para **dev/teste**, e quase sempre má ideia para prod de equipe pequena (backup, HA, upgrade e storage viram seu problema).
- **"Todo mundo containeriza"** — não é critério. PaaS (Heroku-like, App Runner, Cloud Run from source, Vercel) entrega o mesmo resultado com menos operação para apps padrão.

---

## Regra de bolso

> Containerize quando **(a)** o ambiente de execução é parte do problema (dependências, paridade, múltiplos serviços), ou **(b)** a plataforma de deploy escolhida pede imagem. Caso contrário, use a opção gerenciada mais simples que atende.

Escada de simplicidade (pare no primeiro degrau que atende):

```
estático/CDN → serverless (funções) → PaaS (deploy do código) → container em serviço gerenciado → orquestração própria (ver 05)
```

> Esta é a **escada canônica** do playbook. O [05-kubernetes-eks](05-kubernetes-eks.md) detalha os dois últimos degraus (container gerenciado → orquestração) na AWS — as duas escadas são o mesmo caminho, em zoom diferente.

---

## Se containerizar, faça direito (mínimos não-negociáveis)

Este checklist é a referência completa — o manual do DevOps (`multi-agents/agents/08-devops.md`) cobre um subconjunto e aponta para cá; complementa o [06-devsecops](06-devsecops.md):

- [ ] **Multi-stage build**; imagem final mínima (alpine/distroless/slim).
- [ ] **Non-root** (`USER` explícito); read-only filesystem quando possível.
- [ ] **Tag pinada** (digest ou versão) — nunca `latest` em prod.
- [ ] **Healthcheck** definido; resource limits (CPU/mem) declarados.
- [ ] **Secrets injetados** em runtime — nunca na imagem (nem em `ARG`/layer intermediária).
- [ ] **Scan de imagem** no pipeline (Trivy/Grype) antes do push ao registry.
- [ ] `.dockerignore` cobrindo `.git`, `.env`, `node_modules`, artefatos locais.
- [ ] Um processo por container; logs em stdout/stderr.

---

## Checklist de decisão (para o ADR do Architect)

- [ ] Qual problema o container resolve aqui (paridade? isolamento? plataforma exige)?
- [ ] Existe degrau mais simples na escada que atende os NFRs?
- [ ] Quem mantém base image, patches e registry? (é um custo permanente)
- [ ] Dev local fica melhor (compose) ou pior (build lento a cada mudança)?
- [ ] Estado fica fora do container (volume gerenciado / serviço gerenciado)?

---

## Fontes

- 12-Factor App — [config](https://12factor.net/config), [build/release/run](https://12factor.net/build-release-run), [processes](https://12factor.net/processes)
- Docker — [Building best practices](https://docs.docker.com/build/building/best-practices/)
- Google Cloud — [Best practices for building containers](https://cloud.google.com/architecture/best-practices-for-building-containers)
- [Cerulean Cloud — When to Use ECS vs EKS vs Lambda](https://blog.ceruleancloud.ca/when-to-use-ecs-vs-eks-vs-lambda-a-decision-framework) (workload profile como critério)
