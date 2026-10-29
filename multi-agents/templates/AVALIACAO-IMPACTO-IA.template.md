# Avaliação de Impacto de IA — {task_id}

> Template do controle **ISO/IEC 42001 A.5** (avaliação de impacto de sistemas de IA).
> Gravado como `tasks/{task_id}/artifacts/impacto-ia.md`. Escritor: **AI-Engineer**; auditado pelo **Security-SRE** no gate.
>
> **Quando é obrigatório** (basta um gatilho): a feature entrega decisão, classificação ou conteúdo gerado por IA a **usuário final**; processa **dado pessoal** com IA; ou a saída influencia decisão sobre pessoas (crédito, contratação, atendimento, priorização).
> **Quando não é:** uso interno do Claude Code no desenvolvimento — esse uso já está coberto por `DESENVOLVIMENTO-COM-IA.md` e `praticas/10-dados-e-contexto-de-ia.md`.
>
> Alvo: **30–60 minutos.** Passou muito disso, o escopo do sistema está grande demais — volta ao Planner.

---

**Task:** {task_id} · **Responsável:** {nome} · **Data:** AAAA-MM-DD
**Gatilho que disparou esta avaliação:** {qual dos gatilhos acima}
**Classe de dado envolvida** (`praticas/10` §2): Pública | Interna | Confidencial | Restrita

## 1. O sistema (A.5.2)

- **Finalidade:** {o que o sistema decide, gera ou classifica — em uma frase}
- **Uso pretendido:** {quem usa, em que contexto, para que decisão}
- **Uso indevido previsível:** {como alguém usaria isto fora do previsto — inclua o uso "conveniente porém errado", não só o malicioso}
- **Grau de autonomia:** sugere ao humano | decide com revisão | decide sozinho
- **Modelo e provedor:** {modelo, versão, provedor — e a avaliação de fornecedor de `praticas/10` §5 está feita?}
- **Dados que alimentam o sistema:** {origem, proveniência, base legal se houver dado pessoal (LGPD art. 7º)}

## 2. Quem é afetado (A.5.4)

| Grupo afetado | Como é afetado | Pode optar por não usar? | Sabe que é IA? |
|---|---|---|---|
| {ex: cliente final} | {...} | sim/não | sim/não |

## 3. Impacto sobre indivíduos (A.5.4)

- **Decisão automatizada sobre pessoa?** sim/não. Se sim: o titular pode pedir revisão (LGPD art. 20)? Como, na prática?
- **Viés e equidade:** {que grupos podem receber saída sistematicamente pior, e como isso foi medido — "não avaliamos" é resposta válida e vira risco na §5}
- **Erro do sistema:** o que acontece com a pessoa quando erra? Falso positivo e falso negativo custam o mesmo?
- **Explicabilidade:** dá para dizer ao afetado por que a saída foi essa?
- **Privacidade:** dado pessoal no prompt, no índice de RAG ou nos logs? Prazo de retenção e rotina de expurgo definidos?

## 4. Impacto societal e ambiental (A.5.5)

{Preencha proporcionalmente ao alcance. Sistema interno para 20 pessoas: uma linha. Sistema que atende milhares de cidadãos: leve a sério — deslocamento de trabalho, concentração de decisão, desinformação, acessibilidade, custo computacional.}

## 5. Riscos e mitigações

| # | Risco | Probab. | Impacto | Mitigação | Dono | Risco residual |
|---|---|---|---|---|---|---|
| 1 | {ex: prompt injection via documento recuperado} | M | A | {...} | {...} | {aceito por / eliminado} |

Referências obrigatórias de checagem: OWASP Top 10 for LLM (injection, vazamento, output handling, excessive agency) e `praticas/06-devsecops.md`.
**Risco residual só o Tech Lead aceita**, com nome e data — igual a `GOVERNANCE.md` §3.5.

## 6. Supervisão humana e transparência (A.9.2)

- **Ponto de controle humano:** {onde uma pessoa pode revisar, corrigir ou desligar — e ela tem informação suficiente para isso?}
- **Kill switch:** como se desliga o sistema em produção, e quem tem esse poder?
- **Divulgação ao usuário:** como fica claro que a saída é gerada por IA?
- **Canal de contestação:** como o afetado reclama, e para quem?

## 7. Monitoramento pós-implantação (A.6.2.6)

- **Métricas acompanhadas:** {qualidade via evals, taxa de recusa, latência, custo, deriva de distribuição}
- **Gatilho de reavaliação:** {troca de modelo, mudança de finalidade, incidente, revisão periódica — defina a data}
- **Runbook de incidente de IA:** {link}

## 8. Veredito

**Veredito:** APROVADO | APROVADO COM CONDIÇÕES | REPROVADO
**Condições:** {se houver}
**Avaliado por:** {AI-Engineer} · **Auditado por:** {Security-SRE} · **Risco residual aceito por:** {Tech Lead, se aplicável} · **Data:** AAAA-MM-DD
