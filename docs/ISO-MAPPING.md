# Rastreabilidade ISO/IEC 27001:2022 e ISO/IEC 42001:2023

> Pergunta que este documento responde: **quais controles das normas o playbook atende, com que evidência, e o que ainda falta?**
>
> Este é o documento que se entrega ao auditor (interno ou de certificação). Ele **não** é um SGSI nem um SGIA — ver `docs/ADR-004-conformidade-iso.md` para o enquadramento e as fronteiras.
>
> **Dono:** Tech Lead · **Revisão:** semestral, ou a cada mudança em `GOVERNANCE.md` · **Última revisão:** 2026-11-05

---

## 1. Como ler esta tabela

O playbook é a **camada de controle operacional** de desenvolvimento. As cláusulas 4–10 de ambas as normas (contexto, liderança, análise de risco, competência, auditoria interna, análise crítica, melhoria) são da **organização**, não deste repositório — estão marcadas como `ORG` e listadas na §5.

| Status | Significado |
|---|---|
| **OK** | Atendido com evidência versionada e verificável neste repo |
| **PARCIAL** | Controle existe, mas depende de configuração externa, preenchimento ou decisão pendente |
| **LACUNA** | Não atendido — ação necessária, listada na §4 |
| **ORG** | Fora do escopo do playbook; responsabilidade da camada organizacional |

Regra de evidência: **um controle só é "OK" se um auditor puder abrir um arquivo deste repo e verificar sozinho.** Intenção documentada sem artefato verificável é PARCIAL, não OK.

---

## 2. ISO/IEC 27001:2022 — Anexo A

Escopo desta tabela: os controles com relação direta com o ciclo de vida de desenvolvimento. Os demais (A.7 físicos, continuidade, RH em sentido amplo) são ORG por natureza e não estão listados.

### A.5 — Controles organizacionais

| Controle | Título (resumo) | Status | Evidência / observação |
|---|---|---|---|
| **A.5.2** | Papéis e responsabilidades de SI | OK | `GOVERNANCE.md` §1 — Tech Lead, Analista/Dev, Agentes, com responsabilidade final humana |
| **A.5.3** | Segregação de funções | OK | `GOVERNANCE.md` §3.4 — quem implementa não aprova (Coder ≠ Reviewer); escopo de ferramentas por agente no frontmatter `tools:` |
| **A.5.4** | Responsabilidades da direção | ORG | — |
| **A.5.8** | SI na gestão de projetos | OK | `GOVERNANCE.md` §5 — repo privado, branch protection e travas antes do primeiro commit |
| **A.5.12** | Classificação da informação | PARCIAL | `praticas/10-dados-e-contexto-de-ia.md` §2 classifica dado para fins de contexto de IA. Classificação corporativa geral é ORG |
| **A.5.14** | Transferência de informação | OK | `praticas/10` §3 — envio de dado a provedor de IA tratado como transferência, com regra por classe |
| **A.5.15** | Controle de acesso | PARCIAL | Branch protection (§2.6) e `permissions.deny` cobrem o repo; acesso a sistemas corporativos é ORG |
| **A.5.19** | SI em relações com fornecedores | PARCIAL | `praticas/10` §4 define o que exigir do provedor de IA; contrato/DPA assinado é ORG |
| **A.5.20** | SI em acordos com fornecedores | ORG | DPA e termos com Anthropic/GitHub/cloud — camada jurídica |
| **A.5.21** | SI na cadeia de suprimento ICT | OK | `praticas/06-devsecops.md` camada 2 (SCA, lockfile, SBOM) + auditoria de supply chain do Security-SRE |
| **A.5.23** | SI para serviços em nuvem | PARCIAL | `praticas/05-kubernetes-eks.md` e `praticas/06` camada 4 (CSPM, IAM); depende de `praticas/00` preenchido |
| **A.5.24–5.28** | Gestão de incidentes de SI | OK | `praticas/06` trata secret commitado como incidente; [`RUNBOOK-INCIDENTE-IA.md`](RUNBOOK-INCIDENTE-IA.md) cobre os três cenários específicos de IA com detecção, contenção, comunicação e aprendizado |
| **A.5.31** | Requisitos legais e contratuais | OK | `praticas/06` seção LGPD — base legal, direitos do titular, art. 48 |
| **A.5.34** | Privacidade e proteção de PII | OK | `praticas/06` seção LGPD + `praticas/10` §2 e §3.1: dado pessoal real nunca entra em fixture, log, artifact ou ambiente de teste; em prompt, só dado comum com autorização vigente do cliente registrada em `docs/autorizacoes/` e conferida pelo hook no `done` (`docs/ADR-011`) |
| **A.5.36** | Conformidade com políticas | OK | Travas mecânicas (§6) — conformidade verificada por hook, não por declaração |
| **A.5.37** | Procedimentos operacionais documentados | OK | `multi-agents/agents/NN-*.md`, `HANDOFF-PROTOCOL.md`, `ONBOARDING.md` |

### A.6 — Controles de pessoas

| Controle | Título (resumo) | Status | Evidência / observação |
|---|---|---|---|
| **A.6.3** | Conscientização e treinamento | PARCIAL | `ONBOARDING.md` + `DESENVOLVIMENTO-COM-IA.md` são o material; [`COMPETENCIA.md`](COMPETENCIA.md) é o registro — **falta cada pessoa preencher a própria linha** (§4.6) |
| **A.6.6** | Confidencialidade / NDA | ORG | — |
| **A.6.8** | Reporte de eventos de SI | PARCIAL | "Trava disparou → reporte ao Tech Lead" (§6.3); canal formal de reporte é ORG |

### A.8 — Controles tecnológicos

| Controle | Título (resumo) | Status | Evidência / observação |
|---|---|---|---|
| **A.8.2** | Direitos de acesso privilegiado | OK | Least privilege por agente (`tools:` no frontmatter); agente não altera as próprias travas |
| **A.8.4** | Acesso ao código-fonte | OK | `GOVERNANCE.md` §2.6 (branch protection) + `permissions.deny` sobre `.claude/settings.json`, `.claude/hooks/` e `GOVERNANCE.md`; `.claude/workflows/` e `.claude/agents/` na mesma zona protegida desde 2026-09-29 (`docs/patches/README.md`, Histórico) |
| **A.8.7** | Proteção contra malware | ORG | Endpoint corporativo |
| **A.8.8** | Gestão de vulnerabilidades técnicas | OK | `praticas/06` camadas 1–3 (SAST, SCA, IaC, imagem) + gate do Security-SRE; regra anti-slopsquatting para dependência sugerida por IA |
| **A.8.9** | Gestão de configuração | OK | `.claude/settings.json` e `.claude/hooks/` versionados e protegidos contra escrita pelos agentes |
| **A.8.10** | Exclusão de informação | PARCIAL | Retenção/expurgo de dado pessoal em `praticas/06` (LGPD item 4); retenção de **evidência do playbook** definida em `docs/EVIDENCIAS-E-METRICAS.md` |
| **A.8.12** | Prevenção de vazamento de dados | OK | `praticas/10` §2–§3 — regra de classe por contexto de IA; `gitleaks` (hook local + CI) e `scripts/check-pii.sh` sobre fixtures/seeds (`praticas/06`); leitura de `.env`/`.env.*` negada a agentes no `permissions.deny` desde 2026-09-29 |
| **A.8.15** | Registro (logging) | OK | `tasks/{id}/run-log.md` append-only + `artifacts/*.md` por agente; retenção em `docs/EVIDENCIAS-E-METRICAS.md` |
| **A.8.16** | Atividades de monitoramento | PARCIAL | Métricas do playbook definidas em `docs/EVIDENCIAS-E-METRICAS.md`; monitoramento de runtime é `praticas/06` camada 4 |
| **A.8.19** | Software em sistemas operacionais | ORG | — |
| **A.8.24** | Uso de criptografia | OK | `praticas/06`, princípio 6 — TLS, cifra gerenciada, argon2/bcrypt, "não invente crypto" |
| **A.8.25** | Ciclo de vida de desenvolvimento seguro | OK | **O playbook inteiro.** `GOVERNANCE.md` §3 (fluxo obrigatório) + `multi-agents/ARCHITECTURE.md` |
| **A.8.26** | Requisitos de segurança da aplicação | OK | Spec-Writer entrega NFRs e critérios de aceitação antes do design (`docs/ADR-003`) |
| **A.8.27** | Princípios de arquitetura e engenharia seguras | OK | `praticas/07-clean-architecture.md`, `praticas/06` (8 princípios de projeto seguro), ADRs em `docs/` |
| **A.8.28** | Codificação segura | OK | `praticas/01-clean-code.md` + `praticas/08-design-funcional.md` + regras duras do Coder (sem hardcode de segredo) |
| **A.8.29** | Testes de segurança em desenvolvimento e aceitação | OK | Tester (`praticas/09`) + gate do Security-SRE em task sensível, verificado por hook |
| **A.8.30** | Desenvolvimento terceirizado | OK (por analogia) | O agente de IA é tratado como desenvolvedor terceirizado: escopo definido, entrega revisada, responsabilidade final humana (`GOVERNANCE.md` §1) |
| **A.8.31** | Separação de dev, teste e produção | PARCIAL | Checklist pré-deploy do DevOps; depende de `praticas/00` preenchido |
| **A.8.32** | Gestão de mudanças | OK | Draft PR → Reviewer → ready → merge; PRs de 200–400 linhas; branch protection |
| **A.8.33** | Informação de teste | OK | `praticas/06` LGPD — dado pessoal real nunca em fixture ou ambiente de teste; dado sintético/anonimizado |
| **A.8.34** | Proteção de sistemas durante auditoria | ORG | — |

**Resumo 27001:** 25 OK · 9 PARCIAL · 0 LACUNA · 6 ORG. *(40 controles; A.8.30 é OK por analogia.)*

---

## 3. ISO/IEC 42001:2023 — Anexo A

A organização tem **duas relações distintas** com IA, e elas caem em partes diferentes do Anexo A. Confundi-las é o erro mais comum neste enquadramento:

- **Escopo (a) — organização como *usuária* de IA:** o Claude Code no desenvolvimento. É o escopo dominante do playbook.
- **Escopo (b) — organização como *produtora* de sistemas de IA:** features com LLM/RAG entregues a clientes (agente AI-Engineer). Coberto pelo playbook apenas onde marcado.

| Controle | Título (resumo) | Escopo | Status | Evidência / observação |
|---|---|---|---|---|
| **A.2.2** | Política de IA | a+b | OK | `DESENVOLVIMENTO-COM-IA.md` (postura, riscos e mitigações) + `GOVERNANCE.md` (regra vinculante) |
| **A.2.3** | Alinhamento com outras políticas | a+b | OK | `praticas/06` (DevSecOps/LGPD) e `praticas/10` referenciados pela governança |
| **A.2.4** | Revisão da política de IA | a+b | OK | Cadência de revisão por documento em `docs/EVIDENCIAS-E-METRICAS.md` §4 |
| **A.3.2** | Papéis e responsabilidades de IA | a+b | OK | `GOVERNANCE.md` §1 + tabela de agentes em `DESENVOLVIMENTO-COM-IA.md` §2 |
| **A.3.3** | Reporte de preocupações | a+b | PARCIAL | §6.3 (reportar falso positivo de trava) e §3.5 (risco residual só o Tech Lead aceita); canal anônimo é ORG |
| **A.4.2** | Documentação de recursos | a | OK | `docs/ADR-001-modelos-por-agente.md` — que modelo, onde e por quê |
| **A.4.3** | Recursos de dados | b | PARCIAL | `praticas/10` §2 classifica o dado; qualidade/proveniência de dado de treino é do AI-Engineer por projeto |
| **A.4.4** | Recursos de ferramental | a | OK | `.claude/settings.json`, `.claude/agents/`, hooks — ferramental versionado e auditável |
| **A.4.5** | Recursos de sistema e computação | a | ORG | Contratação e cotas do provedor |
| **A.4.6** | Recursos humanos (competência) | a+b | PARCIAL | `ONBOARDING.md`; [`COMPETENCIA.md`](COMPETENCIA.md) é o registro — **falta cada pessoa preencher a própria linha** (§4.6) |
| **A.5.2** | Processo de avaliação de impacto de IA | a+b | OK | `multi-agents/templates/AVALIACAO-IMPACTO-IA.template.md` + gatilho no `brief.md` |
| **A.5.3** | Documentação da avaliação de impacto | a+b | OK | Artefato versionado em `tasks/{id}/artifacts/impacto-ia.md` |
| **A.5.4** | Impacto sobre indivíduos e grupos | b | OK | Seção 3 do template (inclui viés, grupos afetados e recurso humano à decisão) |
| **A.5.5** | Impacto societal | b | PARCIAL | Seção 4 do template; profundidade depende do caso de uso |
| **A.6.1.2** | Objetivos para desenvolvimento responsável | a+b | OK | `DESENVOLVIMENTO-COM-IA.md` §1 e §4 (riscos reconhecidos → mitigação concreta) |
| **A.6.1.3** | Processos de design e desenvolvimento responsáveis | a+b | OK | `GOVERNANCE.md` §3 — fluxo multi-agent obrigatório com gates |
| **A.6.2.2** | Requisitos e especificação do sistema de IA | b | OK | Spec-Writer (`docs/ADR-003`) — critérios Given/When/Then e NFRs mensuráveis antes do código |
| **A.6.2.3** | Documentação de design e desenvolvimento | a+b | OK | ADRs em `docs/` + artifacts por agente |
| **A.6.2.4** | Verificação e validação | a+b | OK | Gate do Reviewer verificado por `check-reviewer-gate.mjs` (segunda linha); no fluxo por script (ADR-005) a primeira linha é o próprio código — `playbook-task.js` só devolve `done` após veredito validado por schema; piloto do script ainda pendente. Evals obrigatórios do AI-Engineer |
| **A.6.2.5** | Implantação | b | PARCIAL | Checklist pré-deploy do DevOps; depende de `praticas/00` |
| **A.6.2.6** | Operação e monitoramento | b | PARCIAL | `praticas/06` camada 4; monitoramento específico de LLM (drift, custo, taxa de recusa) é do AI-Engineer por projeto |
| **A.6.2.7** | Documentação técnica | a+b | OK | Documenter, após aprovação do Reviewer |
| **A.6.2.8** | Registro de eventos (log) | a+b | OK | `run-log.md` append-only; retenção em `docs/EVIDENCIAS-E-METRICAS.md` |
| **A.7.2–A.7.6** | Dados para sistemas de IA | b | PARCIAL | `praticas/10` §2 (classificação) e `praticas/06` (dado sintético em teste); proveniência e preparação são do Data-Engineer/AI-Engineer por projeto |
| **A.8.2** | Documentação para usuários do sistema | b | OK | Documenter — README, API docs, runbook |
| **A.8.3** | Reporte externo | b | ORG | Canal ao titular/cliente |
| **A.8.4** | Comunicação de incidente | a+b | OK | LGPD art. 48 em `praticas/06`; [`RUNBOOK-INCIDENTE-IA.md`](RUNBOOK-INCIDENTE-IA.md) define quem aciona o DPO, em que prazo e por qual cenário |
| **A.9.2** | Processos para uso responsável | **a** | OK | `GOVERNANCE.md` §3 e **§7** (em vigor desde 2026-08-31 — torna a classificação de dado lei, não referência) + `praticas/10`; o que a IA nunca faz em `DESENVOLVIMENTO-COM-IA.md` §7 |
| **A.9.3** | Objetivos para uso responsável | a | OK | `DESENVOLVIMENTO-COM-IA.md` §1 |
| **A.9.4** | Uso pretendido | a | OK | Escopo por agente em `.claude/agents/` e `multi-agents/agents/`; agente fora do escopo é anti-padrão registrado |
| **A.10.2** | Alocação de responsabilidades | a+b | OK | `GOVERNANCE.md` §1 — "você é responsável pelo que a IA produziu em seu nome" |
| **A.10.3** | Fornecedores de IA | a | PARCIAL | `praticas/10` §4 define os critérios de avaliação; assinatura de DPA e verificação de opt-out de treino são ORG (§4.7) |
| **A.10.4** | Clientes / obrigações contratuais | b | ORG | Camada comercial/jurídica |

**Resumo 42001:** 22 OK · 8 PARCIAL · 0 LACUNA · 3 ORG.

**Supervisão humana** (A.9.2, e também Art. 14 do EU AI Act, se vier a ser exigido): o playbook atende de forma explícita e mecânica — nenhuma task fecha sem veredito humano-revisável do Reviewer, e o dev que abre o PR assume a responsabilidade. Onde o projeto define `revisao_humana: obrigatoria` (`praticas/00`, `docs/ADR-011`) — e sempre em task com dado pessoal autorizado —, a revisão humana vira evidência própria: `artifacts/revisao-humana.md` com revisor e data, exigido pelo hook antes do `done`. Com `dispensada`, a evidência de supervisão é o gate dos agentes mais o PR. Esse é o ponto mais forte do conjunto perante um auditor.

---

## 4. Ações abertas

Numeração estável.

| # | Ação | Controles | Dono | Tipo | Status |
|---|---|---|---|---|---|
| **4.1** | Ativar branch protection nos repos existentes | A.8.4, A.8.32 | Tech Lead | Configuração | **PARCIAL** (2026-08-31) — ativa em `AI-Playbook`; replicar nos demais repos |
| **4.2** | Confirmar a classe do plano Anthropic e preencher `praticas/00` (política de dado em prompt já preenchida) | A.5.23, A.8.31, A.6.2.5 | Tech Lead | Decisão | Aberta — falta confirmar comercial vs. consumidor (ver 4.7 e a nota em `praticas/00` → IA/LLM) |
| **4.3** | Aprovar `GOVERNANCE.md` §7 (patch em arquivo protegido) | A.5.36, A.8.15, A.9.2 | Tech Lead | Patch em arquivo protegido | **FEITA** (2026-08-31) |
| **4.4** | Definir SLA de correção por severidade | A.5.24, A.8.8 | Tech Lead | Decisão | **FEITA** (2026-08-31) — achado que impacta o processo é bloqueador até resolução humana (`praticas/06`) |
| **4.5** | Runbook de incidente envolvendo IA (vazamento via prompt, código defeituoso em prod, dependência alucinada) | A.5.24–5.28, A.8.4 (42001) | Security-SRE + Tech Lead | Documento novo | **FEITA** (2026-08-31) — [`RUNBOOK-INCIDENTE-IA.md`](RUNBOOK-INCIDENTE-IA.md) |
| **4.6** | Registro de competência: quem leu o onboarding, quando, e revalidação anual | A.6.3, A.4.6 | Tech Lead | Processo (`docs/`) | **PARCIAL** (2026-08-31) — [`COMPETENCIA.md`](COMPETENCIA.md) criado; **falta cada pessoa registrar a própria linha** |
| **4.7** | Verificar termos do provedor de IA: retenção, opt-out de treino, sub-processadores, DPA | A.5.19, A.5.20, A.10.3 | Tech Lead + jurídico | Contrato | **Aberta — prioridade máxima.** DPA é automático nos Termos Comerciais, mas não alcança plano de consumidor; confirmar a classe do plano (ver 4.2) |
| **4.8** | Registro de risco e Declaração de Aplicabilidade (SoA) | Cláusulas 6.1.2–6.1.3 | Camada ORG | Documento organizacional | Aberta |
| **4.9** | Auditoria interna e análise crítica pela direção | Cláusulas 9.2–9.3 | Camada ORG | Processo organizacional | Aberta |

---

## 5. O que este repositório deliberadamente não cobre

As cláusulas 4–10 de ambas as normas são o **sistema de gestão** e pertencem à organização:

| Cláusula | O que exige | Onde vive |
|---|---|---|
| **4** | Contexto, partes interessadas, escopo do SGSI/SGIA | Documento organizacional |
| **5** | Liderança, política, papéis organizacionais | Direção |
| **6** | Análise/tratamento de risco, SoA, objetivos | Registro de risco corporativo (ação 4.8) |
| **7** | Competência, conscientização, comunicação, documentação | Parcial aqui (ação 4.6); registro é ORG |
| **8** | Operação | **É onde este playbook vive** |
| **9** | Monitoramento, auditoria interna, análise crítica | Métricas aqui (`docs/EVIDENCIAS-E-METRICAS.md`); auditoria é ORG (ação 4.9) |
| **10** | Não conformidade e melhoria contínua | ORG; alimentado pelas métricas daqui |

Dizer a um auditor que o repositório "é a ISO 27001 da empresa" é o caminho mais rápido para perder credibilidade. A afirmação correta é: **o playbook é o controle operacional da cláusula 8, com evidência versionada para os controles do Anexo A listados acima.**

---

## Fontes

- ISO/IEC 27001:2022 — *Information security management systems — Requirements* (Anexo A: 93 controles em 4 temas)
- ISO/IEC 27002:2022 — guia de implementação dos controles do Anexo A
- ISO/IEC 42001:2023 — *Artificial intelligence management system* (Anexo A: objetivos de controle A.2–A.10)
- ISO/IEC 23894:2023 — gestão de risco de IA (método para a ação 4.8 no recorte de IA)
- [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework) — vocabulário de risco de IA compatível com a 42001
