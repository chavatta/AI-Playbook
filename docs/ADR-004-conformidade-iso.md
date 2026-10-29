# ADR-004 — Enquadramento do playbook na ISO/IEC 27001 e ISO/IEC 42001

**Status:** Aceito
**Data:** 2026-08-28
**Decisores:** Tech Lead
**Revisão:** semestral
**Relacionado:** referencia `docs/ISO-MAPPING.md` (rastreabilidade), `praticas/10-dados-e-contexto-de-ia.md` e `praticas/06-devsecops.md`. Não supersede nenhum ADR anterior.

## Contexto

A organização precisa posicionar o playbook perante ISO/IEC 27001:2022 (segurança da informação) e ISO/IEC 42001:2023 (gestão de IA) — seja para certificação futura, seja para responder a due diligence de cliente.

O risco aqui não é técnico, é de **enquadramento**. Ambas as normas são de *sistema de gestão*: cláusulas 4–10 (contexto, liderança, análise de risco, competência, auditoria interna, análise crítica, melhoria) mais um Anexo A de controles. Certificação é da **organização**, nunca de um repositório. Apresentar o playbook como "nosso SGSI" a um auditor destrói credibilidade no primeiro contato e contamina a avaliação dos controles que de fato existem — e eles são bons: as travas do playbook são mecânicas, e controle verificável por hook vale mais em auditoria do que política escrita.

Havia também uma ambiguidade específica da 42001: a organização **usa** IA (Claude Code no desenvolvimento) e **produz** sistemas de IA (features com LLM/RAG para clientes). Esses dois papéis caem em partes diferentes do Anexo A e não podem ser tratados como um só.

## Decisão

1. **O playbook é a camada de controle operacional (cláusula 8) do SGSI e do SGIA da organização — não é o sistema de gestão.** É essa a frase usada com auditor, cliente e em RFP.
2. **Rastreabilidade em documento próprio:** `docs/ISO-MAPPING.md` mapeia controle → evidência → status (OK / PARCIAL / LACUNA / ORG), com dono e revisão semestral. É o artefato entregue ao auditor.
3. **Régua de evidência:** um controle só é "OK" se um auditor puder abrir um arquivo versionado deste repo e verificar sozinho. Intenção documentada sem artefato verificável é PARCIAL.
4. **A 42001 é tratada em dois escopos explícitos:** (a) organização como *usuária* de IA — escopo dominante, ancorado em A.9 (uso responsável), A.2/A.3 (política e papéis) e A.10.2/A.10.3 (responsabilidades e fornecedor); (b) organização como *produtora* de sistemas de IA — A.5 (avaliação de impacto), A.6 (ciclo de vida) e A.7 (dados), cobertos por projeto pelo Spec-Writer, Data-Engineer e AI-Engineer.
5. **A maior lacuna identificada vira lei, não recomendação:** o playbook proibia segredo em prompt, mas não classificava dado de cliente, PII e informação confidencial. Fechada por `praticas/10-dados-e-contexto-de-ia.md`, com o gatilho no `brief.md` e a regra em `GOVERNANCE.md` §7.
6. **Avaliação de impacto de IA (42001 A.5) é obrigatória por gatilho, não por default:** template em `multi-agents/templates/AVALIACAO-IMPACTO-IA.template.md`, exigido quando a feature entrega decisão ou conteúdo de IA a usuário final ou processa dado pessoal com IA. Task interna comum não dispara — burocratizar tudo geraria bypass cultural, o mesmo argumento de `praticas/06` contra travar pipeline por LOW teórico.
7. **Eficácia é medida, não presumida:** `docs/EVIDENCIAS-E-METRICAS.md` define retenção de evidência, métricas do playbook e cadência de revisão — insumo da cláusula 9 (análise crítica), que é organizacional.

## Alternativas consideradas

1. **Declarar conformidade do repositório** — falso: sem cláusulas 4–10, sem SoA e sem auditoria interna não há conformidade. Custo alto (credibilidade), benefício nenhum.
2. **Escrever um SGSI completo dentro do repo** — misturaria camada organizacional com operacional, criaria documento que ninguém mantém e que contradiz a política corporativa quando ela existir. A norma não exige que more no repo; exige que exista e seja mantido.
3. **Tratar 27001 e 42001 no mesmo documento de controles** — os escopos se sobrepõem (segurança de dado em contexto de IA aparece nas duas), mas as perguntas de auditoria são diferentes. Um documento com duas tabelas resolve; dois documentos duplicariam evidência.
4. **Adiar até haver decisão de certificar** — a maior parte do trabalho (classificação de dado em prompt, retenção de evidência, avaliação de impacto) é boa engenharia independentemente de certificação, e é mais barata agora do que retroativa.

## Consequências

**Positivas:** posição defensável perante auditor e cliente; a lacuna real de vazamento de dado via prompt fechada com trava de processo; evidência de conformidade gerada como subproduto do fluxo normal, sem trabalho extra por task; base pronta se a certificação for decidida.

**Negativas / custos:** dois documentos novos a manter em cadência semestral; toda task passa a declarar classe de dado no `brief.md` (linha a mais, atrito baixo, mas real); 9 ações abertas em `ISO-MAPPING.md` §4, das quais 4 dependem de camada organizacional fora do alcance do playbook.

**Risco aceito:** os controles marcados PARCIAL permanecem parciais até que `praticas/00` seja preenchido e os itens organizacionais avancem. Não se declara "OK" antecipadamente — o status na tabela é o estado real, e essa honestidade é o que faz o documento valer em auditoria.

## Revisão

Semestral junto com `docs/ISO-MAPPING.md`, ou imediatamente se: a organização decidir buscar certificação, mudar de provedor de IA, ou o EU AI Act passar a ser exigível para algum cliente.
