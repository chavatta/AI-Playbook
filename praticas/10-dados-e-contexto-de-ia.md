# 10 — Dados e Contexto de IA

> Pergunta que este documento responde: **que informação pode entrar no contexto de um modelo de IA — e sob que condição?**
>
> Princípio-mãe: **tudo que entra no contexto pode sair na resposta, e sai do nosso perímetro no momento em que entra.** Prompt enviado a um provedor externo é transferência de dado, não uso de ferramenta local.
>
> Este documento é a régua do Analista/Dev e de todos os agentes, e o critério de auditoria do Security-SRE nesse recorte. Complementa `praticas/06-devsecops.md` (seções LGPD e Segurança de sistemas com IA) — aqui está o **como classificar e decidir**; lá está o método de segurança em volta.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-11-05

---

## 1. Por que esta é a regra mais fácil de quebrar

As outras travas do playbook são mecânicas: o hook bloqueia o push, o gate barra o `done`. Esta não tem trava possível — **nenhuma ferramenta consegue distinguir, dentro de um arquivo colado no chat, o que é código e o que é a base de clientes.** A decisão é humana, acontece em segundos e não deixa rastro se ninguém a registrar.

É também a regra cuja violação é irreversível: código ruim se corrige no PR seguinte; dado enviado a um terceiro não volta. Por isso ela é lei (`GOVERNANCE.md` §7), não recomendação.

---

## 2. As quatro classes

Classifique pelo **dado mais sensível presente**, não pela média. Um arquivo de configuração com uma senha é Restrito inteiro.

| Classe | O que é | Exemplos típicos | Regra em contexto de IA |
|---|---|---|---|
| **Pública** | Já divulgado ou destinado a divulgação | Documentação pública, código open source, dado agregado publicado | **Livre.** |
| **Interna** | Uso interno, sem dano relevante se vazar | Código-fonte próprio do playbook, ADRs, runbooks, arquitetura genérica | **Livre no ferramental aprovado.** |
| **Confidencial** | Dano contratual, competitivo ou reputacional se vazar | Código e dados de cliente, contratos, credenciais de arquitetura (nomes de host, topologia), dado pessoal comum (nome, e-mail, CPF) | **Permitido só com as 3 condições da §3.** Minimização obrigatória: envie o trecho, não o repositório. |
| **Restrita** | Vazamento é incidente com dever legal ou perda direta | Segredo/credencial/token/chave, dado pessoal **sensível** (LGPD art. 5º II — saúde, biometria, origem racial, religião, opinião política, vida sexual), dado de criança e adolescente, dado sob NDA que proíba subprocessamento | **Nunca entra. Sem exceção, sem "só dessa vez", sem autorização do Tech Lead.** |

**Nota sobre a classe Restrita:** ela não tem porta de exceção de propósito. Uma regra com exceção autorizável vira uma regra negociada sob pressão de prazo — e o custo de um erro aqui (art. 48 da LGPD, notificação à ANPD e aos titulares) é desproporcional a qualquer ganho de velocidade. Precisa mesmo do dado? Use as saídas da §4.

---

## 3. As três condições para dado Confidencial

Dado Confidencial só entra no contexto quando **as três** valem simultaneamente:

1. **Ferramental aprovado** — a ferramenta está na lista de `praticas/00-stack-e-defaults.md`. Ferramenta pessoal, extensão de navegador, chatbot de conveniência ou MCP não homologado **não** são ferramental aprovado, mesmo que usem o mesmo modelo por trás.
2. **Contrato que cubra o subprocessamento** — o provedor tem termos comerciais com DPA e **opt-out de treinamento** verificados (§4). Plano gratuito ou pessoal quase sempre falha aqui.
3. **Minimização** — só o necessário para a tarefa. Um trecho, não o arquivo; um arquivo, não o repositório; schema, não a tabela com linhas reais.

Falhou uma? O dado não entra. Ponto.

### 3.1 Dado pessoal comum: autorização do cliente

Quando o Confidencial é **dado pessoal comum de cliente** (nome, e-mail, CPF, endereço), vale uma quarta condição: **autorização vigente do cliente**, registrada em `docs/autorizacoes/` pelo modelo `multi-agents/templates/AUTORIZACAO-DADOS-PESSOAIS.template.md` (`docs/ADR-011`).

- Na LGPD o cliente costuma ser o **controlador** e nós o **operador**; o provedor de IA é **suboperador**. A autorização é a instrução do controlador para o operador usar esse suboperador. Ela **não substitui** a base legal (art. 7º), o consentimento do titular nem a condição 2 acima.
- Vale só para a finalidade, as categorias, os sistemas e os provedores escritos no registro, e só até a `Validade`.
- **Não alcança a classe Restrita.** Dado sensível, de menores e credenciais continuam proibidos, com ou sem autorização.
- A task declara `Dados pessoais: autorizados — <registro>` no `brief.md`. Isso a torna sensível e exige revisão humana registrada antes de `done`.
- Mesmo autorizado, o dado passa primeiro pelas saídas da §4: execução local que devolve agregado, depois trecho mínimo. E **nunca** vai para artifact, run-log, fixture, teste, log ou commit.

Sem registro vigente, dado pessoal real não entra no contexto.

**Quem decide em caso de dúvida:** o Analista/Dev classifica; dúvida entre Confidencial e Restrito sobe ao Tech Lead **antes** do envio, nunca depois. Na dúvida não resolvida, trate como a classe mais alta.

---

## 4. Saídas quando o dado não pode entrar

Não precisa parar o trabalho — quase sempre há um caminho:

- **Dado sintético** — gere fixtures que preservem forma e cardinalidade sem conteúdo real. É a saída padrão para teste e debug (já é regra em `praticas/06`).
- **Anonimização / pseudonimização** — substitua identificadores antes de colar. Cuidado: anonimização mal-feita é reidentificável; combinação de campos aparentemente inócuos identifica pessoa.
- **Abstração do problema** — descreva a estrutura ("tabela de pacientes com CPF, diagnóstico e data") em vez de colar as linhas. Na maioria das tarefas de engenharia, o modelo precisa do **schema**, não dos valores.
- **Trecho mínimo** — 20 linhas em volta do bug resolvem mais que o arquivo de 2000.
- **Execução local** — o agente roda o script contra o dado real na máquina e devolve o resultado agregado; o dado nunca vira token.

---

## 5. Avaliação do provedor de IA

Antes de aprovar uma ferramenta para dado Confidencial, verifique e registre (dono: Tech Lead; controles ISO 27001 A.5.19/A.5.20 e ISO 42001 A.10.3):

| Critério | O que confirmar |
|---|---|
| **Treinamento** | O provedor treina modelos com nosso input? Existe opt-out contratual e ele está ativo? |
| **Retenção** | Por quanto tempo o prompt fica armazenado? Onde? Há prazo configurável? |
| **Localização** | Em que país o processamento ocorre? Transferência internacional exige base legal (LGPD cap. V) |
| **Subprocessadores** | Quem mais toca o dado? Há lista publicada e notificação de mudança? |
| **DPA** | Existe acordo de tratamento de dados assinado, com o papel de cada parte definido? |
| **Certificações** | O provedor tem ISO 27001/42001 ou SOC 2? Serve como evidência na nossa cadeia (A.5.21) |
| **Isolamento** | Nosso dado é usado no contexto de outro cliente? Há tenancy separada? |

O resultado dessa avaliação vive em `praticas/00-stack-e-defaults.md`. Ferramenta sem essa avaliação é aprovada **apenas para dado Interno**.

---

## 6. A saída também é classificada

O controle não termina no prompt. Resposta de IA sobre dado Confidencial herda a classe do insumo: não vai para issue pública, não vira exemplo em documentação, não é colada em canal externo. E vale a regra de `praticas/06`: **saída de LLM é entrada não-confiável** — código gerado passa pelo Reviewer, comando gerado é validado, conteúdo recuperado por RAG nunca é instrução.

---

## 7. Vazou — o que fazer

Dado Restrito ou Confidencial enviado indevidamente é **incidente, não achado**. Mesma lógica de secret commitado:

1. **Se for credencial:** revogue e rotacione imediatamente. Remover a mensagem não desfaz o envio.
2. **Comunique o Tech Lead na hora.** Não avalie sozinho a gravidade e não conte com o provedor apagar.
3. **Se envolver dado pessoal:** o Tech Lead aciona o encarregado (DPO) para avaliar risco ao titular e a obrigação de comunicar ANPD e titulares (LGPD art. 48). Quem decide isso não é o dev.
4. **Registre** no `run-log.md` da task e no artifact do Security-SRE, se houver. Incidente sem registro não gera aprendizado nem evidência.

Sem cultura punitiva: quem reporta rápido reduz o dano. Quem esconde transforma um erro em uma violação.

---

## 8. Como isso aparece no fluxo

- **`brief.md`** — o Orchestrator declara a **classe de dado** da task junto com o marcador de sensibilidade. Task Confidencial ou Restrita é automaticamente sensível (gate do Security-SRE). Dado pessoal autorizado (§3.1) vai no campo `Dados pessoais`, com o caminho do registro; a skill `/task` confere o registro antes de abrir a task, e o hook confere a validade no `done`.
- **Coder / Data-Engineer** — não colam dado real em prompt, fixture, log ou ambiente de teste; usam sintético.
- **AI-Engineer** — a feature que constrói herda estas regras para os **usuários finais** dela: o que o usuário pode mandar para o modelo, e o que o RAG pode recuperar, é decisão de design documentada na avaliação de impacto.
- **Security-SRE** — audita esta classificação no gate de task sensível.
- **Reviewer** — item de checklist: o diff introduz dado real em fixture, seed, log ou teste?

---

## 9. Checklist rápido (antes de colar)

- [ ] Sei qual é a classe do dado mais sensível deste conteúdo?
- [ ] Se Confidencial: ferramental aprovado, contrato verificado e minimizado?
- [ ] Se for dado pessoal comum: há autorização vigente do cliente que cubra esta finalidade (§3.1)?
- [ ] Se Restrito: parei e usei uma saída da §4?
- [ ] Há credencial, token ou chave escondida em config, comentário ou histórico colado junto?
- [ ] Consigo resolver com schema/estrutura em vez de valores reais?
- [ ] A resposta que vou receber pode ir para onde pretendo colar depois?

---

## Fontes

- [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) (arts. 5º II, 7º, 18, 33–36, 48) · [ANPD — guias orientativos](https://www.gov.br/anpd/pt-br)
- ISO/IEC 27001:2022 — A.5.12 (classificação), A.5.14 (transferência), A.8.12 (prevenção de vazamento), A.5.19–5.21 (fornecedores)
- ISO/IEC 42001:2023 — A.7 (dados para sistemas de IA), A.9.2 (uso responsável), A.10.3 (fornecedores)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — LLM02 Sensitive Information Disclosure, LLM01 Prompt Injection
- [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework)
