# Runbook — Incidente envolvendo IA

> Pergunta que este documento responde: **aconteceu. O que eu faço agora, nesta ordem, e quem decide o quê?**
>
> Cobre os três cenários que o desenvolvimento com IA introduz e que um runbook de segurança comum não trata. Atende ISO/IEC 27001:2022 A.5.24–A.5.28 (gestão de incidentes) e ISO/IEC 42001:2023 A.8.4. É a ação **4.5** do [`ISO-MAPPING.md`](ISO-MAPPING.md) §4.
>
> **Dono:** Tech Lead · **Revisão:** semestral, e depois de todo incidente real · **Última revisão:** 2026-08-31

---

## 0. Antes de tudo

**Não investigue sozinho antes de comunicar.** O erro mais comum em incidente não é a ação errada — é a hora perdida entre "acho que aconteceu" e "avisei alguém". Comunicar cedo custa um alarme falso ocasional; comunicar tarde custa o prazo legal.

**Sem cultura punitiva.** Quem reporta rápido reduz o dano e não é punido por isso. Quem esconde transforma um erro em uma violação — e aí sim há consequência. Esta frase está no `GOVERNANCE.md` §7.3 e é o que faz o runbook funcionar na prática.

**Registre enquanto acontece**, no `run-log.md` da task, ou num arquivo novo em `tasks/` se o incidente não nasceu de uma task. Reconstruir a linha do tempo depois é sempre pior, e é ela que o auditor pede.

| Papel | Decide |
|---|---|
| **Quem detectou** | Nada. Contém o óbvio (revogar credencial), comunica e registra |
| **Tech Lead** | Severidade, acionamento do DPO, rollback, comunicação a cliente, aceite de risco residual |
| **DPO / encarregado** | Se há dever de comunicar ANPD e titulares (LGPD art. 48). **Não é o dev, nem o Tech Lead** |
| **Security-SRE** | Análise técnica de causa e escopo; proposta de correção |

---

## 1. Vazamento de dado por prompt

Dado Confidencial ou Restrito foi enviado ao contexto de um modelo — colado no chat, incluído num arquivo aberto, retornado por uma ferramenta MCP ou capturado num log de sessão.

**Detecção.** Quase sempre humana: a pessoa percebe depois de enviar. Também chega por revisão de PR (dado real em fixture), pelo `scripts/check-pii.sh` no CI, ou por `gitleaks`.

**Contenção — primeiros 15 minutos, em ordem.**

1. **Se houver credencial, segredo, token ou chave: revogue e rotacione imediatamente.** Antes de avisar qualquer pessoa, antes de avaliar gravidade. Apagar a mensagem **não** desfaz o envio, e a janela de exploração de um segredo é medida em minutos.
2. Pare de usar a sessão afetada. Não continue a task "só para terminar".
3. Comunique o Tech Lead. Diga o que foi enviado, para qual ferramenta e conta, e quando.
4. **Não apague o rastro.** A tentação de deletar a conversa é forte e é errada: sem ela não se determina o escopo, e a deleção vira achado de auditoria pior que o vazamento.

**Erradicação e escopo.** O Tech Lead, com o Security-SRE, determina: qual a classe do dado (`praticas/10` §2), qual conta e plano receberam (comercial ou consumidor — muda retenção e uso para treino, ver `praticas/00`), quantos titulares foram afetados, e se houve saída derivada colada em outro lugar (issue, PR, canal externo). **Só depois de a linha do tempo estar registrada**, apague a conversa no provedor: em plano de consumidor com treino desligado, isso inicia o relógio de retenção de 30 dias e exclui o conteúdo de treino futuro (`praticas/00`); apagar antes de registrar destrói a evidência do escopo. Deletar a conversa não substitui a rotação de credencial — o segredo já saiu no envio.

**Comunicação — o prazo que importa.** Se envolver dado pessoal, **o Tech Lead aciona o DPO no mesmo dia**. É o DPO, não o time técnico, que avalia risco ao titular e a obrigação do art. 48 da LGPD de comunicar ANPD e titulares em prazo razoável. Se o dado for de cliente, a comunicação ao cliente é decisão do Tech Lead com a liderança — nunca do dev que reportou.

**Fechamento.** Registro no `run-log.md`; se a causa foi ferramenta ou plano inadequado, atualização de `praticas/00`; se foi lacuna de regra, atualização de `praticas/10`. Conta na métrica **M7** (`EVIDENCIAS-E-METRICAS.md` §3), cuja meta é zero e cuja qualquer ocorrência dispara análise de causa.

---

## 2. Código gerado por IA defeituoso em produção

Passou pelo gate, foi para produção e quebrou — bug funcional, falha de segurança ou degradação.

**Detecção.** Alerta de runtime, erro de usuário, ou achado tardio em revisão.

**Contenção.** É o caminho normal de incidente de produção: **rollback primeiro, diagnóstico depois** (`praticas/06`, camada 4, e o runbook de rollback do DevOps). Se houver exposição de dado ou de credencial, trate também pelo cenário 1 — os dois correm juntos, não em sequência.

**Erradicação.** O Debugger reproduz e isola a causa; o Coder corrige sob spec; o teste de regressão é obrigatório (`praticas/09`) — bug corrigido sem teste que o prenda volta.

**A pergunta que este cenário obriga a fazer:** *o gate falhou, ou o gate não existia?*

- O Reviewer aprovou algo que deveria ter reprovado → o problema é o **critério** de review. Ajuste o checklist do Reviewer.
- Ninguém olhou porque a task foi tratada como trivial → o problema é a **classificação** de complexidade. Ajuste o critério do Orchestrator.
- O caso não estava na spec → o problema é a **spec**. Ajuste o Spec-Writer.

Responder "a IA errou" encerra a investigação no lugar errado. A IA sempre pode errar; o playbook existe para que errar não chegue em produção. **O achado do post-mortem é sobre o gate, não sobre o modelo.**

**Comunicação.** Quem decide é o **Tech Lead**, assim que o rollback estabiliza. Se houve impacto a usuário, a comunicação ao cliente é dele com a liderança, no mesmo dia do incidente — não do dev. Se o defeito expôs dado pessoal, cai também no cenário 1: aciona o DPO, com o prazo do art. 48 da LGPD. Bug de produção sem exposição de dado não tem obrigação legal de notificação externa, mas o registro interno é obrigatório de qualquer forma.

**Fechamento.** Post-mortem sem culpado, com uma ação concreta por causa. Se o gate mudou, atualize o documento que o define no mesmo PR — post-mortem cuja conclusão não altera nenhum documento não mudou nada.

---

## 3. Dependência alucinada ou comprometida

Código gerado importou um pacote que não existe, existe com outro propósito, ou é typosquatting de um pacote legítimo — o vetor conhecido como *slopsquatting*: um atacante registra o nome que os modelos costumam inventar e espera.

**Detecção.** Build quebrando por pacote inexistente é o caso **feliz** — falhou fechado. O caso perigoso é o pacote **existir**: instala, funciona, e ninguém olha. Pegam isto o SCA (`osv-scanner`/Trivy), o Renovate, e o item de checklist do Reviewer sobre dependência nova.

**Contenção.** Se já foi instalado em qualquer ambiente: trate como **supply chain comprometida** até prova em contrário. Remova o pacote, invalide o lockfile, e **rotacione os segredos que estiveram no ambiente onde ele rodou** — script de pós-instalação lê variável de ambiente. Se foi para produção, some o cenário 2.

**Erradicação.** O Security-SRE audita o que o pacote fez: scripts de instalação, rede, arquivos tocados. Confirme o pacote legítimo pretendido, pelo repositório oficial, não pelo nome que o modelo sugeriu.

**A regra preventiva**, que vale mais que este runbook: **dependência nova é decisão, não detalhe.** O Coder não adiciona pacote fora do que a spec previu; dependência nova aparece explicitamente no PR e o Reviewer verifica que ela existe, é mantida e é a que se pretendia. Nome plausível não é evidência de existência — e é exatamente nisso que o modelo é convincente.

**Comunicação.** Quem decide é o **Tech Lead** com o Security-SRE, assim que o escopo estiver mapeado. Se um segredo esteve no ambiente em que o pacote rodou, a rotação é imediata (contenção acima) e o incidente cai também no cenário 1. Para fora: se o pacote era malicioso, **reporte ao registry no mesmo dia** (npm/PyPI removem por abuso) e avise os outros times da organização que possam ter importado o mesmo nome — o slopsquatting mira o erro que vários modelos cometem igual, então raramente é um repo só. Comunicação a cliente só se o pacote alcançou ambiente dele, e é decisão do Tech Lead.

**Fechamento.** Registro; report ao registry se malicioso; e varredura dos demais repos da organização pelo mesmo nome de pacote, porque o vetor se repete entre projetos.

---

## 4. O que fazer depois, em qualquer cenário

1. **Linha do tempo no `run-log.md`** — detecção, contenção, erradicação, comunicação, com horários.
2. **Análise de causa** — sem culpado, focada no controle que faltou.
3. **Uma ação por causa**, com dono e data. Ação sem dono não é ação.
4. **O documento muda junto.** Incidente que não altera nenhuma regra, trava ou checklist provavelmente não foi analisado até o fim.
5. **Atualize este runbook.** Cenário real que não se encaixou nos três acima vira o quarto.

---

## Fontes

- [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), art. 48 (comunicação de incidente) · [ANPD](https://www.gov.br/anpd/pt-br)
- ISO/IEC 27001:2022 — A.5.24 a A.5.28 (planejamento, avaliação, resposta e aprendizado com incidentes)
- ISO/IEC 42001:2023 — A.8.4 (resposta a incidente em sistema de IA)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — LLM02 (divulgação de informação sensível), LLM05 (supply chain)
- `praticas/10-dados-e-contexto-de-ia.md` §7 · `praticas/06-devsecops.md` · `GOVERNANCE.md` §7
