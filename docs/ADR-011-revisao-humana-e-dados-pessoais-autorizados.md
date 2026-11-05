# ADR-011 — Revisão humana por projeto e dado pessoal autorizado pelo cliente

**Status:** Proposto — vira Aceito quando o Tech Lead aplicar os patches de `docs/patches/` (workflow, hook e `GOVERNANCE.md`)
**Data:** 2026-11-05
**Decisores:** Tech Lead
**Revisão:** semestral
**Última revisão:** 2026-11-05
**Relacionado:** ADR-002 (gate do Security-SRE), ADR-005 (fluxo por script), ADR-009 (prefixo estável do prompt). Não trata do DPA nem da classe do plano: a ação 4.7 do `ISO-MAPPING.md` continua aberta e separada.

## Contexto

Dois pedidos do Tech Lead:

1. **Revisão humana como parâmetro.** Hoje a revisão do PR pelo dev é obrigatória em todo projeto (`GOVERNANCE.md` §2.2), mas nada no fluxo a registra: o script devolve `done` assim que o Reviewer aprova, e a evidência humana fica implícita no PR. Há projetos em que o time quer essa revisão obrigatória e registrada; outros em que o gate dos agentes basta.
2. **Dado pessoal com autorização do cliente.** Hoje o playbook se contradiz: `praticas/10` §2 põe o dado pessoal comum na classe Confidencial, que pode entrar no contexto sob três condições, enquanto `praticas/00`, `praticas/06` e o `ISO-MAPPING.md` dizem "dado pessoal real **nunca**". Há tarefas — investigação de bug com dado de produção, migração, conciliação — em que o cliente quer autorizar a leitura.

Na LGPD o cliente costuma ser o **controlador** e a GBPA a **operadora**; o provedor de IA é **suboperador**. O Guia de Agentes de Tratamento da ANPD pede autorização formal do controlador para o operador contratar suboperador. A autorização do cliente **não substitui** a base legal (art. 7º) nem o consentimento do titular: ela é a instrução do controlador ao operador.

## Decisão

### D1 — Revisão humana

1. **Parâmetro do projeto:** `revisao_humana` no bloco `perfil-fluxo` de `praticas/00-stack-e-defaults.md`, com os valores `obrigatoria` (padrão, igual ao comportamento atual) ou `dispensada`.
2. **Campo do brief:** `**Revisão humana:** obrigatória | dispensada`. A skill `/task` copia o valor do projeto; a task pode **subir** para obrigatória, nunca descer abaixo do projeto.
3. **Piso:** task com dado pessoal autorizado (D2) é sempre `obrigatória`, qualquer que seja o projeto.
4. **Task sensível sozinha não força revisão humana.** Código de cliente é Confidencial, e Confidencial torna a task sensível (`GOVERNANCE.md` §7.2). Forçar a revisão em toda task sensível tornaria o `dispensada` inútil em projeto de cliente. Task sensível já tem três lentes paralelas e o refutador cego; a divergência entre eles já é decisão humana. Trade-off aceito e revisável.
5. **No script:** com revisão obrigatória, o fluxo aprovado devolve `aguardando_revisao_humana` em vez de `done`. Todo retorno traz `revisao_humana`.
6. **Registro:** `tasks/{id}/artifacts/revisao-humana.md`, com a primeira linha `**Veredito:** APROVADO` ou `**Veredito:** REPROVADO (n pontos)` e a linha `**Revisor:** <nome> · AAAA-MM-DD`. Escritor: o próprio revisor, ou a sessão transcrevendo o que ele disse na conversa (mesma regra do `decisions.md`, `HANDOFF-PROTOCOL.md` §2.1). Agente nunca grava veredito humano por conta própria. Comando: `/task aprovar <task_id>`.
7. **Gate mecânico:** o hook `check-reviewer-gate.mjs` bloqueia o `done` sem esse registro quando o brief marca `Revisão humana: obrigatória` ou declara dado pessoal autorizado.
8. **`dispensada` não dispensa:** o Reviewer, o Security-SRE em task sensível, o refutador cego, a decisão humana na divergência, a aceitação de risco pelo Tech Lead e a responsabilidade do dev pelo que a IA produz em nome dele (`GOVERNANCE.md` §1). O merge continua sendo um ato humano. Projeto com `dispensada` e branch protection exigindo aprovação é contradição: a configuração do repositório prevalece.

### D2 — Dado pessoal autorizado pelo cliente

1. **Registro da autorização:** `docs/autorizacoes/<cliente>-<AAAA-MM-DD>.md`, pelo modelo `multi-agents/templates/AUTORIZACAO-DADOS-PESSOAIS.template.md`. O documento assinado fica com o jurídico; o repositório guarda só o registro e onde está o original.
2. **Alcance:** só dado pessoal **comum**. Dado pessoal sensível (art. 5º II), de criança ou adolescente e credenciais continuam na classe Restrita, sem exceção — a autorização do cliente não abre essa porta.
3. **É uma condição a mais, não um atalho:** dado pessoal autorizado continua Confidencial e precisa das três condições de `praticas/10` §3 **e** da autorização vigente (nova §3.1).
4. **Campo do brief:** `**Dados pessoais:** não | autorizados — docs/autorizacoes/<arquivo>.md`. A skill confere, antes de abrir a task, que o registro existe, está `vigente`, dentro da validade e cobre a finalidade.
5. **Efeitos na task:** sensível (gate do Security-SRE, Coder em Opus) e revisão humana obrigatória (D1.3).
6. **No prompt dos agentes:** a regra da autorização entra na parte variável (`## Esta task`), para não quebrar o prefixo estável do ADR-009. Ordem de acesso: execução local que devolve agregado, depois trecho mínimo; nunca o conjunto.
7. **Nunca em evidência:** dado pessoal real continua proibido em artifact, run-log, fixture, teste, log e commit. A evidência é retida por 3 anos e é versionada.
8. **Gate mecânico:** no `done`, o hook confere que o registro citado no brief existe e que a `**Validade:**` cobre a data do `done` no run-log. Comparar com a data do `done`, e não com a data de hoje, evita que tasks antigas passem a bloquear quando a autorização vencer.

## Alternativas consideradas

- **Revisão humana só como campo informativo, sem gate.** Rejeitada: o pedido é poder exigir, e exigência sem trava vira opcional sob prazo (`praticas/10` §1).
- **Task sensível força revisão humana.** Rejeitada pelo D1.4; fica como opção se o Tech Lead preferir rigor a autonomia.
- **Autorização do cliente abre também dado sensível.** Rejeitada: a classe Restrita foi criada sem porta de exceção de propósito (`praticas/10` §2, nota).
- **Autorização só no brief, sem registro próprio.** Rejeitada: o brief é por task; a autorização é por cliente, tem validade e precisa sobreviver à task como evidência.

## Consequências

- **Positivas:** revisão humana registrada e verificável quando exigida; fim da contradição entre `praticas/00`, `06` e `10`; trilha da instrução do controlador ao operador.
- **Negativas:** mais um estado de retorno (`aguardando_revisao_humana`) e um comando (`/task aprovar`); o hook passa a ler datas do run-log.
- **Risco residual:** a condição 2 de `praticas/10` §3 (contrato com o provedor) **não muda** com este ADR. Enquanto a ação 4.7 do `ISO-MAPPING.md` estiver aberta, a autorização sozinha não habilita dado pessoal no contexto.
- **Mecanismo:** `docs/patches/playbook-task.js`, `docs/patches/check-reviewer-gate.mjs` e `docs/patches/GOVERNANCE.proposto.md`, com os casos novos em `scripts/test-playbook-task.mjs` e `docs/patches/test-check-reviewer-gate.mjs`.

## Fontes

- [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), arts. 5º II, 7º, 11, 33–39
- [ANPD — Guia Orientativo para Definições dos Agentes de Tratamento](https://egov.df.gov.br/wp-content/uploads/2023/07/Guia-Orientativo-%E2%80%93-Definicoes-dos-agentes-de-Tratamento-de-Dados-Pessoais-e-dos-Encarregados-%E2%80%93-ANPD.pdf) (suboperador e autorização do controlador)
- [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024) (transferência internacional)
- ISO/IEC 42001:2023 A.9.2 (supervisão humana) · ISO/IEC 27001:2022 A.5.34 (privacidade e PII)
