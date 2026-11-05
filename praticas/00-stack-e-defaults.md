# 00 — Stack e Defaults do Projeto

> Pergunta que este documento responde: **quais são as escolhas-padrão deste projeto, para que nem agentes nem devs re-decidam o já decidido?**
>
> As práticas 01–09 são critérios de mercado; **este arquivo é o que as ancora no projeto**. Em conflito entre uma preferência pessoal (ou de agente) e um default daqui, o default vence — desvio se justifica em ADR.
>
> **Preenchido por projeto, não uma vez pela organização.** Cada repo que adota o playbook carrega o seu 00 e o preenche no início (`ONBOARDING.md §2`, passo 6) — dois projetos da organização podem ter stacks legitimamente diferentes.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-11-05

## Campo em branco não é blocker — é um menu

Na primeira task que esbarrar num campo `{...}` vazio, o **Architect não decide em silêncio nem devolve o problema**. Ele apresenta:

1. **As opções candidatas** do campo — a coluna "Opções" desta página é o ponto de partida, adaptada ao contexto real do projeto (o que o time já sabe operar, o que já existe no repo, restrição de custo ou de cliente).
2. **Uma recomendação, com o porquê em uma linha** — e o que se perde escolhendo diferente.
3. **A opção explícita "decida você, Architect"** — que é a resposta certa quando você não tem preferência e quer seguir sem parar a task. Não é abdicar: a decisão vira ADR e fica auditável como qualquer outra.

Escolhida a opção (ou delegada ao Architect), a decisão vira **ADR** e o valor **volta para esta tabela**, com o ADR citado na coluna "Nota". A partir daí é default do projeto e ninguém re-decide.

**Escale ao Tech Lead, não ao Architect,** os campos marcados 🔒 — custo recorrente, contrato com terceiro, risco jurídico ou de dados pessoais não são decisão de projeto.

> Legenda das opções: **★** = ponto de partida sugerido pelo playbook (não é decisão da organização — é onde começar a conversa quando ninguém tem preferência forte).

---

## Cloud e infraestrutura

| Default | Valor | Opções (★ = ponto de partida) | Nota |
|---|---|---|---|
| Cloud padrão 🔒 | `{...}` | ★ **AWS** · GCP · Azure · nenhuma (on-prem/VPS) | ★ só porque os exemplos deste arquivo e das práticas 04/05 assumem AWS. Rodagem do time pesa mais que a marca — se o time opera GCP melhor, GCP ganha |
| Região padrão | `{...}` | ★ **sa-east-1 / southamerica-east1 (São Paulo)** · us-east-1 · região na UE | ★ pela latência e por manter dado de cliente brasileiro no país (LGPD). us-east-1 é mais barata e tem mais serviços — trade-off consciente, e some se houver dado pessoal |
| Deploy default | `{...}` | ★ **PaaS/serverless de container** (Cloud Run, App Runner, Fly) · ECS+Fargate · Kubernetes (EKS/GKE) | Escada do [04](04-containerizacao.md)/[05](05-kubernetes-eks.md): comece no degrau mais baixo que atende. K8s exige justificativa em ADR, não é default |
| Registry de containers | `{...}` | ★ **registry da própria cloud** (ECR / Artifact Registry) · GHCR · Docker Hub | ★ evita credencial cross-cloud e egress. Quem mantém base images e política de CVE: `{dono}` |
| IaC | `{...}` | ★ **Terraform ou OpenTofu** · Pulumi · CDK · nenhum (console) | "Nenhum" só é aceitável em projeto descartável — infra clicada não é reproduzível. Estado remoto em: `{onde}` |

## Linguagens e tooling

| Default | Valor | Opções (★ = ponto de partida) | Nota |
|---|---|---|---|
| Linguagens oficiais | `{...}` | ★ **TypeScript (produto) + Python (dados/IA)** · Go (serviços de alta concorrência) · outra | Fora da lista escolhida = ADR do Architect. Menos linguagens = menos tooling para manter |
| Runtime/versões mínimas | `{...}` | ★ **Node LTS ativo + Python 3.12+** · versão anterior se houver dependência travada | Fixe a versão no `.nvmrc`/`.python-version` e no CI — "funciona na minha máquina" nasce aqui |
| Formatter + linter | `{...}` | ★ **Biome (TS) / ruff (Python)** · Prettier+ESLint / black+flake8 | ★ por serem uma ferramenta só e ordens de grandeza mais rápidas; a stack clássica ganha se você depende de plugin específico do ESLint. Config compartilhada em: `{repo/pacote}` — regra de [01-clean-code](01-clean-code.md) que dá para automatizar vive aqui, não em prosa |
| Gerenciador de pacotes / monorepo | `{...}` | ★ **pnpm workspaces (+ Turborepo se monorepo) / uv (Python)** · npm · yarn · poetry | Instrumenta "monorepo nasce com workspaces" do [03](03-monorepo-vs-multirepo.md) |
| Result/erros como valor | `{...}` | ★ **exceção na borda, Result no domínio** · Result em tudo (neverthrow) · exceção em tudo | ★ é o meio-termo do [08](08-design-funcional.md): erro esperado é valor, erro inesperado sobe. Fronteira exata deste projeto: `{critério}` |

## Banco e dados

| Default | Valor | Opções (★ = ponto de partida) | Nota |
|---|---|---|---|
| Banco padrão | `{...}` | ★ **Postgres gerenciado** (RDS / Cloud SQL / Neon / Supabase) · MySQL gerenciado · SQLite (embarcado/edge) | Sempre serviço gerenciado — [04](04-containerizacao.md). Postgres ★ por cobrir relacional, JSON e vetor sem trocar de banco |
| Ferramenta de migration | `{...}` | ★ **a do ORM já em uso** (prisma / drizzle / alembic) · dbmate (SQL puro) · Flyway | ★ evita duas fontes de verdade do schema; dbmate ganha se você quer SQL sem ORM. Sempre expand-contract com rollback (manual do Data-Engineer) |
| Vetores | `{...}` | ★ **pgvector no mesmo Postgres** · serviço dedicado (Qdrant, Pinecone) · nenhum | ★ enquanto couber: um banco a menos para operar. Dedicado só quando pgvector não atender o volume — com número no ADR, não por antecipação |

## CI/CD e segurança (instrumenta o [06](06-devsecops.md))

| Default | Valor | Opções (★ = ponto de partida) | Nota |
|---|---|---|---|
| CI | `{...}` | ★ **GitHub Actions** · GitLab CI · CircleCI | ★ se o repo já está no GitHub — a branch protection obrigatória abaixo já pressupõe isso |
| SAST | `{...}` | ★ **Semgrep (OSS)** · CodeQL · Snyk Code | CodeQL exige GHAS pago em repo privado 🔒 |
| SCA / updates | `{...}` | ★ **Renovate + osv-scanner** · Dependabot · Snyk Open Source 🔒 | ★ Renovate agrupa e agenda PRs (menos ruído que o Dependabot); osv-scanner cobre a checagem de vulnerabilidade |
| Secrets | `{...}` | ★ **cofre da própria cloud** (Secrets Manager / Secret Manager / Key Vault) · Doppler / 1Password 🔒 · secrets do CI (só para o CI) | `gitleaks` no hook local **e** no CI, em qualquer opção — não é alternativa, é somatório |
| Scan de imagem/IaC | `{...}` | ★ **Trivy** (cobre imagem e IaC) · Checkov (IaC) + Grype (imagem) | ★ por ser uma ferramenta só para os dois alvos |
| **Branch protection** | Obrigatória em `main`/`master` de todo repo: PR obrigatório, ≥1 aprovação, sem force push, status checks verdes | *(não é opcional — sem menu)* | É a trava servidor-side que os hooks locais do playbook **não** substituem. Repo com um só mantenedor roda em transição — 0 aprovações mantendo o PR obrigatório, subindo para 1 + `enforce_admins` quando houver segundo revisor (`GOVERNANCE.md` §2.6; comandos no `ONBOARDING.md` §2 passo 5) |

## IA / LLM

| Default | Valor | Opções (★ = ponto de partida) | Nota |
|---|---|---|---|
| Provedor/modelos 🔒 | **Anthropic — famílias Opus / Sonnet / Haiku / Fable, pisos 5.5 / 5.5 / 5.5 / 5.1** (ADR-010) | ★ **Anthropic** · outro provedor | Trocar exige revisar ADR-001/002/003/010 e a designação de família dos 13 agentes. Fora da API da Anthropic, os aliases resolvem para versões mais antigas e o piso bloqueia os agentes |
| Contrato/DPA 🔒 | **Plano de subscrição — ⚠️ classe a confirmar (ver nota abaixo)** | Comercial (Team / Enterprise / API) · Consumidor (Pro / Max) | O DPA da Anthropic é **incorporado automaticamente aos Termos Comerciais**, com SCCs — não exige assinatura separada. Planos de consumidor **não** são cobertos por ele |
| Dados em prompt | Dado pessoal real **só com autorização vigente do cliente** e só dado comum ([10](10-dados-e-contexto-de-ia.md) §3.1, `docs/ADR-011`); sensível, de menores e credenciais **nunca**. Fixture sintética por seed continua a única fonte em teste e desenvolvimento | *(decidido — sem menu)* | Ver seção LGPD do [06](06-devsecops.md). Verificação no CI: `gitleaks` (segredo) **+** check de padrão de PII sobre fixtures e seeds — somatório, não alternativa |
| Framework de agentes/RAG | `{...}` | ★ **SDK do provedor, direto** · framework de orquestração (LangGraph, LlamaIndex) | ★ é o "padrão mínimo que atende" do manual do AI-Engineer. Framework entra quando o SDK direto já não dá conta — via ADR do Architect, não por antecipação |
| Orquestração do **fluxo de desenvolvimento** | **Nativa do Claude Code** — Workflow (`.claude/workflows/playbook-task.js`) + subagentes + hooks, na assinatura | *(decidido — `docs/ADR-005`; sem menu)* | Automação **fora** do Claude Code (LangGraph, Agent SDK, `claude -p` em servidor) exige API key e ADR: a assinatura cobre uso ordinário do produto, não orquestração externa (legal e compliance do Claude Code). Framework de agentes acima é para o **produto**; esta linha é para o **processo** |

> ### ⚠️ Antes de usar em projeto de cliente — confirmar a classe do plano
>
> "Plano de subscrição" cobre duas realidades contratuais **opostas**, e a diferença decide o que a equipe pode colar em um prompt:
>
> | | Comercial (Team, Enterprise, API) | Consumidor (Pro, Max) |
> |---|---|---|
> | **DPA** | Incorporado automaticamente aos Termos Comerciais, com SCCs | **Não se aplica** |
> | **Treino com o seu conteúdo** | Não, por padrão | **Escolha de cada usuário**, individualmente |
> | **Retenção** | Conforme os termos comerciais | até 5 anos (desidentificado) se o treino estiver ligado; 30 dias se desligado |
> | **Controle organizacional** | Admin da organização | Nenhum — é conta pessoal |
>
> **A consequência, se a subscrição for de consumidor:** falha a condição 2 da [`praticas/10`](10-dados-e-contexto-de-ia.md) §3 (contrato que cubra o subprocessamento). Isso significa que **código e dado de cliente — classe Confidencial — não podem entrar no contexto**, o que inviabiliza o uso normal do playbook em projeto de cliente. Não é uma formalidade de auditoria: é a diferença entre poder e não poder trabalhar com o repositório do cliente aberto.
>
> Some-se o problema de governança: em plano de consumidor, **o interruptor de treino é de cada pessoa**. Não existe visibilidade nem controle central sobre quem ligou.
>
> **Encaminhamento recomendado:** confirmar o plano no Console (Billing). Se for consumidor, migrar para Claude for Work (Team) — é o que faz o DPA valer e devolve controle de administrador. Feito isso, substituir o valor deste campo por algo verificável, no formato: `Claude for Work Team · DPA incorporado aos Termos Comerciais aceitos em AAAA-MM-DD · cópia em docs/contratos/`.
>
> A base legal de transferência internacional sob a LGPD (cap. V) é pergunta para o jurídico, não para o Tech Lead — o DPA traz SCCs em formato europeu.

---

## Perfil do fluxo

Parâmetros do projeto que a skill `/task` lê e passa ao `playbook-task.js` (`docs/ADR-011`). O bloco JSON abaixo é **a única fonte** deles: a skill o lê pelos marcadores, então não mude o formato nem os marcadores.

<!-- perfil-fluxo:inicio -->
```json
{
  "revisao_humana": "obrigatoria"
}
```
<!-- perfil-fluxo:fim -->

| Chave | Valores | Default | O que faz |
|---|---|---|---|
| `revisao_humana` | `obrigatoria` · `dispensada` | `obrigatoria` | **obrigatoria:** o fluxo aprovado para em `aguardando_revisao_humana` e só vira `done` com `artifacts/revisao-humana.md` APROVADO e assinado por um revisor (`/task aprovar <task_id>`); o hook bloqueia o `done` sem ele. **dispensada:** o gate dos agentes basta para o `done`. Não dispensa o Reviewer, o Security-SRE, a decisão humana na divergência nem a responsabilidade do dev (`GOVERNANCE.md` §1). Task com dado pessoal autorizado é sempre obrigatória. Com `dispensada`, mantenha a branch protection coerente: exigir aprovação no GitHub e dispensar aqui é contradição, e o GitHub prevalece |

---

## Orçamento de contexto e execução

Limiares de consumo de contexto do fluxo multi-agent (`docs/ADR-009`). O bloco JSON abaixo é **a única fonte** desses números: o hook `context-budget.mjs`, o `playbook-task.js`, os wrappers `*-quiet` e o relatório de custos o leem daqui. Os valores são o default do playbook; ajuste por projeto e cite o ADR na tabela de notas. Não mude o formato nem os marcadores.

<!-- orcamento-contexto:inicio -->
```json
{
  "paralelismo_max_agentes": 4,
  "checkpoint": {
    "tool_calls_por_faixa": { "trivial": 12, "simples": 12, "media": 20, "complexa": 30 },
    "faixa_padrao": "media",
    "contexto_agente_tokens": 80000,
    "lembrete_a_cada_tool_calls": 10,
    "max_por_fatia": 3
  },
  "sessao_orquestrador": {
    "contexto_max_tokens": 250000,
    "handoff_max_linhas": 120
  },
  "saida_ferramenta": {
    "aviso_resultado_tokens": 8000,
    "leitura_max_linhas_sem_justificativa": 400,
    "saida_para_arquivo_linhas": 150,
    "quiet_max_linhas": 60
  },
  "artefatos": {
    "resumo_max_linhas": 60,
    "max_linhas": 250
  },
  "comandos_longos": {
    "background_acima_segundos": 180,
    "polling_segundos": 120,
    "sem_chamada_max_segundos": 270
  },
  "comandos_quiet": {
    "teste": "",
    "lint": "",
    "analise": ""
  },
  "telemetria": {
    "razao_cache_alerta": 1.5,
    "fator_excesso_cache": 1.1,
    "saida_implausivel_tokens_por_chamada": 20,
    "saida_implausivel_min_chamadas": 10
  }
}
```
<!-- orcamento-contexto:fim -->

| Chave | Default | Por que este default | Nota do projeto |
|---|---|---|---|
| `paralelismo_max_agentes` | 4 | Cabe o maior fan-out do script (3 lentes em task sensível) ou duas fatias com Coder ∥ Tester. Muitos agentes em paralelo disputam o limite de taxa, e espera longa entre chamadas expira o cache; fila é mais barata que reescrita de cache. Sinal de limite de taxa → reduza, não enfileire mais | |
| `checkpoint.tool_calls_por_faixa` | 12 / 12 / 20 / 30 | Teto de tool calls por agente de cada faixa (`multi-agents/ARCHITECTURE.md` → Scaling de Esforço). A releitura cresce com o quadrado das chamadas: um agente de 32 chamadas relê ~4× o de 16. O agente junta leituras e buscas independentes na mesma resposta, então o mesmo trabalho cabe em menos chamadas; passou do teto, checkpoint (ADR-009, adendo 2026-10-31) | |
| `checkpoint.faixa_padrao` | `media` | Usada quando o hook não acha a complexidade da task (recon ou brief) | |
| `checkpoint.contexto_agente_tokens` | 80 000 | Acima disso, cada chamada relê ≥ 80k; um agente novo parte do checkpoint com ~15k. Em execução real, os dois agentes que passaram de 150k leram 3,5 M de 7 M da task (ADR-009, adendo 2026-10-31) | |
| `checkpoint.lembrete_a_cada_tool_calls` | 10 | O aviso repete, mas não a cada chamada — aviso em toda chamada vira ruído | |
| `checkpoint.max_por_fatia` | 3 | Três checkpoints ≈ 4× o teto da faixa. Mais que isso, a fatia está grande demais e volta para o Planner | |
| `sessao_orquestrador.contexto_max_tokens` | 250 000 | A sessão do orquestrador relê tudo a cada turno; acima disso, uma sessão nova que parte do handoff (poucos k de contexto) custa menos que o próximo turno | |
| `sessao_orquestrador.handoff_max_linhas` | 120 | ≈ 2 páginas. Handoff maior está colando conteúdo em vez de apontar | |
| `saida_ferramenta.aviso_resultado_tokens` | 8 000 | ≈ 32 KB: uma leitura de 400 linhas ou uma saída de teste com poucas falhas cabe; log completo não | |
| `saida_ferramenta.leitura_max_linhas_sem_justificativa` | 400 | Mesmo tamanho de um PR (~200–400 linhas): acima disso quase nunca se precisa do arquivo inteiro | |
| `saida_ferramenta.saida_para_arquivo_linhas` | 150 | Saída maior vai para `tasks/{id}/artifacts/` e o agente lê só o trecho | |
| `saida_ferramenta.quiet_max_linhas` | 60 | O que os wrappers `*-quiet` mostram no máximo: falhas + resumo | |
| `artefatos.resumo_max_linhas` | 60 | Spec, design e plano abrem com `## Resumo` deste tamanho e um índice "Seções por papel"; quem vem depois lê o resumo e só a sua seção, não o arquivo inteiro | |
| `artefatos.max_linhas` | 250 | Teto do artefato inteiro. Acima disso o artefato vira vários (ex.: `planner.md` + `planner-grupo-NN.md`); spec de 573 linhas lida por 4 agentes é releitura pura | |
| `comandos_longos.background_acima_segundos` | 180 | Comando com duração esperada acima de ~3 min roda em background (ou com timeout explícito) | |
| `comandos_longos.polling_segundos` | 120 | Intervalo entre consultas ao comando em background; cada consulta é uma releitura barata que mantém o cache vivo | |
| `comandos_longos.sem_chamada_max_segundos` | 270 | O cache dos subagentes tem vida de 5 min contada do início da chamada; 270 s deixa margem. Passou disso, a próxima chamada reescreve o contexto inteiro | |
| `comandos_quiet.*` | vazio | O projeto preenche o comando de teste, lint e análise estática que o wrapper `*-quiet` roda (`scripts/quiet/`). O wrapper roda **sem shell**: aspas valem, mas pipe, `&&`, redirecionamento e `$` são recusados. Comando composto vira um script do projeto (ex.: `npm test`) | |
| `telemetria.razao_cache_alerta` | 1,5 | Razão saudável ≈ 1 (cada token escrito uma vez). 1,5 tolera recomeços legítimos (compactação, 1ª chamada) | |
| `telemetria.fator_excesso_cache` | 1,1 | Folga de 10 % sobre o contexto final antes de contar a escrita como excesso | |
| `telemetria.saida_implausivel_*` | 20 / 10 | Média abaixo de 20 tokens de saída por chamada, em execução com mais de 10 chamadas, indica transcrição com saída parcial | |

---

## Manutenção

- Dono: **Architect do projeto**, com o Tech Lead como escalada para os campos marcados 🔒.
- Todo campo preenchido a partir de uma decisão de task cita o ADR que o originou, na coluna "Nota".
- A coluna "Opções" é do playbook, não deste projeto: **não a apague ao preencher o Valor**. Ela é o que permite reabrir a decisão depois sabendo o que foi descartado.
- Revisão trimestral (junto com ADR-001) — este arquivo envelhece mais rápido que as práticas de mercado.
