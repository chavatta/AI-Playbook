# ADR-007 — Roteamento multi-provedor: papel → lista ordenada de (provedor, modelo)

**Status:** Proposto
**Data:** 2026-09-24
**Decisores:** Tech Lead
**Revisão:** trimestral, junto com o ADR-001
**Relacionado:** generaliza o ADR-001 **sem alterá-lo nem superá-lo**: o ADR-001 continua valendo como o caso de um provedor só (lista de um elemento = `model:` do frontmatter). Complementa os ADR-002/003, porque as listas também valem para os agentes que eles criaram, e o ADR-005: o `playbook-task.js` é o caso de um provedor. Qualquer execução fora do runtime nativo feita por assinatura depende de exceção formal registrada em ADR do projeto que a adotar. Aplica `praticas/10` §2, §3 e §5. Neste mesmo PR, acrescenta a `multi-agents/HANDOFF-PROTOCOL.md` §3.2 os campos **opcionais** `provider` e `needs_human`.
**Confiança:** média. Nenhum fallback entre provedores rodou ainda numa task real, e o sinal de limite e a exposição do modelo não estão confirmados em todos os runtimes (os pontos `[VERIFICAR-EMPÍRICO]` abaixo).

## Contexto

O ADR-001 amarra cada papel a **um** modelo de **um** fornecedor pelo `model:` do frontmatter, e a autoverificação bloqueia qualquer divergência dele. Quando há mais de um provedor disponível (assinaturas de fornecedores diferentes, mais um provedor cobrado por API), três coisas quebram:

1. **Cota como ponto único de falha.** Quando a assinatura bate no limite, o fluxo inteiro para, mesmo com outro provedor pronto.
2. **A autoverificação bloqueia o fallback legítimo.** Rodar em outro provedor é, pela letra do ADR-001, "modelo divergente", e o agente devolve `blocked` justamente quando a troca foi intencional.
3. **Sem lugar para registrar o provedor.** O ponteiro tem `model`, mas não tem provedor, e o mesmo modelo pode ser servido por runtimes e cobranças diferentes. A troca de provedor acaba silenciosa.

Restrições que continuam valendo: ID completo, nunca alias (ADR-001, revisão de 2026-09-23); orquestração fora do runtime nativo exige API key ou exceção formal em ADR (ADR-005); classes de dado e avaliação de provedor (`praticas/10`); o gate como nó mais caro de errar (ADR-001: "um falso APROVADO é o erro mais caro do fluxo").

## Decisão

### 1. Tabela de roteamento

Cada papel (nome-base do agente) mapeia para uma **lista ordenada de entradas** `<provedor>:<modelo>`. A primeira entrada é a **preferida**. As seguintes são **fallback**, na ordem.

```yaml
# .claude/routing.yaml — camada do playbook; o projeto sobrescreve papel a papel no seu próprio .claude/routing.yaml
versao: 1
provedores:                       # tipo de cobrança de cada provedor citado nas listas
  provedor-a: assinatura
  provedor-b: assinatura
  provedor-c: api
papeis:
  coder:        [provedor-a:<id-completo>, provedor-b:<id-completo>]
  reviewer:     [provedor-a:<id-completo>, provedor-b:<id-completo>, provedor-c:<id-completo>]
  security-sre: [provedor-a:<id-completo>, provedor-b:<id-completo>]
gates:                            # diversidade (§6); omitido = off
  reviewer:     {diversidade: off}        # off | prefer | require
  security-sre: {diversidade: off}
equivalencias:                    # opcional: o mesmo modelo servido por provedores diferentes (§6)
  - [provedor-a:<id-completo>, provedor-c:<fornecedor>/<id-completo>]
api:                              # obrigatório para CADA provedor de tipo api usado em alguma lista (§4)
  provedor-c:
    orcamento_usd: {execucao: <valor>, dia: <valor>, mes: <valor>}
    automatico: []                # papéis em que o fallback para este provedor dispensa confirmação; vazio = nunca
```

**Gramática e validação (erro bloqueia o uso da tabela, não é aviso):**

| Regra | Detalhe |
|---|---|
| Entrada | `<provedor>:<modelo>`, separadas no **primeiro** `:`. `<provedor>` = `[a-z0-9-]+`, declarado em `provedores`. `<modelo>` = ID completo **nativo** daquele provedor, que pode conter `/`, `.` e `:` |
| Sem alias | Proibidos família (`opus`, `haiku`), `latest`, `default`, `best`, `auto` e qualquer roteador automático do provedor. O modelo efetivo de um roteador não é conhecido antes da execução, e a autoverificação (§5) perderia a referência. O sufixo de janela de contexto (`[1m]`) é permitido e não conta como outro modelo |
| Lista | Não vazia e sem entrada repetida |
| Coerência com o frontmatter | Se a lista contém entradas do runtime nativo (`claude-code`, ADR-005), a **primeira delas** é igual ao `model:` do frontmatter do agente. Uma fonte da verdade por runtime |
| API | Todo provedor `api` citado tem `orcamento_usd` com as três janelas (§4) |
| Camadas | Efetivo = playbook ← projeto (o projeto troca a lista **inteira** de um papel, não entradas soltas). Um orquestrador externo pode ter camada própria, desde que registre a lista efetiva usada em cada task (§7) |

**Caso de um provedor (ADR-001 intacto).** Sem `.claude/routing.yaml`, ou com o papel ausente dele, a lista do papel é `[claude-code:<model: do frontmatter>]`. É exatamente o comportamento de hoje. Desde o ADR-010 todo frontmatter declara a família (`opus`, `sonnet`, `haiku`, `fable`), então a lista derivada carrega o alias, e só ela o aceita. Entrada escrita na tabela continua exigindo ID completo. Se este ADR for aceito, a regra "Coerência com o frontmatter" passa a comparar a família da primeira entrada nativa com o alias do frontmatter, e não o ID.

**Local e trava.** O arquivo decide qual modelo audita qual código, então é alvo a proteger, pelo mesmo raciocínio do ADR-005 sobre `.claude/workflows/`. Ao aceitar este ADR, `.claude/routing.yaml` entra na zona protegida contra escrita por agentes (patch de `settings.proposto.json`, aplicado pelo Tech Lead). Mudar lista é mudança de governança (ADR-001, "Notas operacionais").

### 2. Resolução da entrada de cada passo

```
resolver(papel, task) -> (entrada, motivo) | decisao_humana(opcoes) | bloqueio
  lista := task.forcada ?? tabela_efetiva[papel] ?? [claude-code:frontmatter(papel).model]
  elegiveis := []
  para e em lista, em ordem:
    m := primeiro motivo de inelegibilidade de e (tabela abaixo, na ordem)
    se m: registrar_pulo(e, m); continuar
    elegiveis += e
  se papel é gate e diversidade(papel) != off: elegiveis := aplicar_diversidade(elegiveis, task)  # §6
  se elegiveis vazio: devolver decisao_humana(motivos dos pulos)
  e := elegiveis[0]
  se e == lista[0]: devolver (e, 'preferida')
  se exige_confirmacao(e, papel, task): devolver decisao_humana(opcoes_de_fallback)             # §3
  devolver (e, motivo_do_salto)       # fallback_limite | indisponivel | diversidade
```

Motivos de inelegibilidade, na ordem de checagem. **Os quatro primeiros são duros:** nenhuma decisão humana no meio do fluxo os sobrescreve.

| # | Motivo | Regra |
|---|---|---|
| 1 | `classe_de_dado` | §8: a classe da task excede o que o provedor pode receber |
| 2 | `nao_permitido_no_projeto` | Provedor fora da lista de provedores permitidos do projeto |
| 3 | `executor_incapaz` | O executor não lança esse runtime. Por exemplo, o `playbook-task.js` só lança o runtime nativo (§9) |
| 4 | `modelo_nao_verificavel` | Papel de gate numa entrada cujo modelo não é verificável (§5, degradação) |
| 5 | `indisponivel` | Não instalado, sem login (checado pelo próprio CLI, sem ler credencial) ou modelo fora da lista do provedor |
| 6 | `pausado_por_limite` | O provedor bateu o limite e ainda não chegou ao reset (§3) |
| 7 | `orcamento` | Provedor de API sem orçamento configurado, ou sem saldo no dia ou no mês (§4) |

### 3. Fallback, com ou sem confirmação humana

A regra vale para **toda** escolha que não seja a primeira entrada da lista, tanto no despacho (entradas anteriores inelegíveis) quanto no meio do run (limite atingido).

| Próxima entrada elegível | Automático? |
|---|---|
| Assinatura de **outro** provedor | **Sim** |
| Mesmo provedor, outro modelo | **Não**: decisão humana. É troca de modelo na mesma conta, não falta de capacidade |
| API, papel listado em `api.<provedor>.automatico` **e** teto do run (§4) disponível | **Sim** |
| API, demais casos | **Não**: decisão humana |
| Nenhuma | Decisão humana |

**Opções da decisão humana:** cada entrada elegível, com a de API escrita como "seguir em `<provedor>` por até US$ X"; "pausar até o reset" (com o horário, quando o runtime informar); "cancelar". Recomendação padrão: a primeira assinatura elegível; se não houver, pausar. Entrada inelegível pelos motivos duros 1 a 4 **não aparece** como opção.

**Limite no meio do run.**
1. O executor só classifica como limite um **sinal confirmado** do runtime: evento estruturado, código de erro ou texto documentado. `[VERIFICAR-EMPÍRICO]` por runtime e por versão fixada. **Degradação:** num runtime sem sinal confirmado, o limite é tratado como falha comum (retentativa ou `blocked`, conforme o executor), e nunca aciona fallback automático.
2. O run fica registrado como interrompido por limite, e o **provedor inteiro** fica pausado até o reset informado. Sem reset informado, vale uma janela padrão conservadora da configuração do executor. Todas as entradas desse provedor passam a ser puladas com `pausado_por_limite`.
3. O run substituto roda no mesmo passo, no mesmo worktree e na mesma branch. Recebe o contexto disponível do run interrompido e o aviso de troca. O artifact parcial é sobrescrito pelo substituto, e só um run do papel fica ativo por vez (escritor único, `GOVERNANCE.md` §4).
4. A cascata é finita por construção: cada salto por limite pausa um provedor.

### 4. Provedor de API: orçamento obrigatório

- **Sem orçamento, sem execução.** Provedor `api` sem `orcamento_usd` nas três janelas (execução, dia, mês) torna a tabela inválida (§1). Em execução, falta de saldo faz a entrada ser pulada com `orcamento`.
- **Teto do run** = `min(execucao, saldo_dia, saldo_mes)`. O executor não inicia nova chamada ao modelo quando o custo acumulado atinge o teto, e o excedente máximo é o custo de uma chamada. Estourou: o run pausa e vira decisão humana ("aumentar o teto desta execução", "seguir em assinatura elegível", "cancelar").
- **Segunda barreira:** limite de crédito na própria credencial, quando o provedor oferecer.
- **Uso automático desligado por padrão** (`automatico: []`). Liberar um papel é mudança de governança.
- **Valores são 🔒 do Tech Lead** (custo recorrente, `praticas/00`). Este ADR fixa a estrutura, não os números.
- **Gateway que troca por conta própria.** Num provedor intermediário que troca de modelo ou de hospedeiro sem pedido, a troca **de modelo** fica desligada na requisição. A troca **de hospedeiro** do mesmo modelo só é aceita dentro da política de dados da avaliação §5 do gateway (sem coleta e sem treino, retenção zero quando a classe exigir). O modelo efetivo é lido da resposta, e divergência é tratada como no §5. `[VERIFICAR-EMPÍRICO]`: quais campos da resposta de cada gateway identificam o modelo e o hospedeiro efetivos. **Degradação:** se nenhum campo identificar, o modelo fica não verificável (§5).

### 5. "Modelo designado" redefinido e autoverificação

**Definição.** O modelo designado de um run é a **entrada roteada efetivamente escolhida** pelo resolvedor (§2) para aquele run, `(provedor, modelo)`, e o executor a informa ao agente na delegação:

```
Entrada roteada: <provedor>:<modelo> (motivo: preferida | fallback_limite | indisponivel | diversidade | forcada | decisao:<ref>)
```

Delegação sem essa linha é o caso de um provedor: o designado é o `model:` do frontmatter no runtime nativo, e o ADR-001 vale literalmente.

**Autoverificação do agente** (substitui, sem contradizer, a camada 2 do ADR-001):

```
esperado := entrada_roteada(delegacao) ?? (claude-code, frontmatter.model)
lido     := ID do modelo no próprio system prompt; NAO_EXPOSTO se o runtime não o expõe
se lido != NAO_EXPOSTO e normaliza(lido) != normaliza(esperado.modelo):
    status: blocked; blocker: "modelo divergente: esperado {provedor}:{modelo}, rodando em {lido}"
se a lista efetiva do papel está acessível (arquivo no worktree) e esperado ∉ lista:
    status: blocked; blocker: "entrada fora da lista de roteamento: {provedor}:{modelo}"
ponteiro: model := lido (ID exato; valor reservado nao-exposto quando NAO_EXPOSTO), provider := esperado.provedor
```

**`normaliza`** considera iguais o ID roteado e o ID lido quando a diferença é só (a) o sufixo de janela `[…]` ou (b) um snapshot datado `-AAAAMMDD` que o provedor acrescentou a um ID roteado **sem data**. Isso já aparece no runtime nativo: a execução pedida como `claude-haiku-4-5` reporta `claude-haiku-4-5-20251001` nas mensagens. Qualquer outra diferença é divergência.

**O que muda e o que não muda:**
- Rodar numa entrada que não é a primeira, quando a delegação diz isso, **deixa de bloquear**. É o fallback legítimo.
- **Continua bloqueando** o downgrade não roteado: modelo padrão do runtime porque a flag de modelo faltou, alias resolvido para outra versão, reroteamento feito pelo próprio provedor (há runtime que o reporta só como aviso não fatal), entrada fora da lista.
- O executor confere por código três valores: **roteado** (a entrada que ele escolheu), **medido** (telemetria ou saída estruturada do runtime) e **declarado** (ponteiro). Divergência sem salto registrado (§7) gera alerta de modelo divergente e, **em papel de gate, anula o veredito**: um veredito dado num modelo que não é o roteado não conta para a aprovação.

**Degradação quando o modelo não é exposto.** `[VERIFICAR-EMPÍRICO]` por runtime: o system prompt revela o ID do modelo? A saída estruturada ou o hook revela? No runtime nativo, os dois revelam. Regras:
- Agente sem o modelo no system prompt: segue, declara `model: nao-exposto`, e a verificação passa a depender só do medido.
- Nem agente nem executor conseguem verificar: o run é **não verificável**. É aceito em papel que não é gate. Em papel de gate (Reviewer, Security-SRE, refutador cego), a entrada é inelegível (`modelo_nao_verificavel`, §2): o gate é onde o ADR-001 concentra o custo do erro.

### 6. Diversidade nos gates (opcional)

- Configuração por papel de gate (`reviewer`, `security-sre`): `off` (padrão do playbook) | `prefer` | `require`.
- **Referência:** o provedor e o modelo do **último run do Coder** da mesma task, depois de eventuais fallbacks.
- **Uma entrada satisfaz a diversidade** quando o provedor é diferente do Coder **e** o modelo não está no mesmo grupo de `equivalencias` do modelo do Coder. Sem essa segunda condição, a diversidade é nominal: o mesmo modelo servido por outro runtime não é segunda opinião.
- `prefer`: usa a primeira elegível que satisfaz. Se nenhuma satisfaz, usa a primeira elegível e registra `diversidade indisponível` no run-log. `require`: se nenhuma satisfaz, vira decisão humana.
- A diversidade **não abre exceção** a nenhum motivo de inelegibilidade nem à regra de confirmação da API. Se a única entrada diversa for API sem autorização automática, vira decisão humana.
- O refutador cego (ADR-005) é roteado como `reviewer` e segue a mesma regra contra o Coder. A lente do Tester não é afetada.
- Com diversidade ligada, a observação do ADR-001 de 2026-09-23 ("gate no mesmo modelo que o código que audita") deixa de ser a única mitigação disponível.

### 7. Sem troca silenciosa

Todo run numa entrada que não é a primeira da lista, qualquer que seja o motivo, fica registrado em quatro lugares:

| Onde | O quê |
|---|---|
| Delegação | A linha `Entrada roteada: … (motivo: …)` (§5) |
| Ponteiro | `provider` e `model` (HANDOFF-PROTOCOL §3.2). Em execução com mais de um provedor, o executor **exige** `provider`. O protocolo o mantém opcional para o caso de um provedor, e a ausência significa `claude-code` |
| `run-log.md` | Linha com `event` = `limite` no run interrompido e `fallback` no substituto, com `ref` = `de <provedor>:<modelo> para <provedor>:<modelo> — <motivo>`. Diversidade indisponível e entradas puladas também vão ao run-log, resumidas numa linha por passo. Esses valores cabem nas colunas que o §5 do protocolo já tem, sem mudar o formato |
| Lista efetiva | O executor registra a lista efetiva de cada papel usada na task, com a camada de origem |

Troca de provedor ou de modelo sem esses registros é, por definição, divergência (§5).

### 8. Interação com `praticas/10`

- **Provedor sem avaliação §5 registrada** (em `praticas/00`) só recebe task de classe **Interna** ou **Pública**.
- **Confidencial:** só provedor com avaliação §5 registrada **e** as três condições do §3 (ferramental aprovado, contrato que cubra o subprocessamento, minimização). **Restrita:** nenhum provedor.
- A classe vem do `brief.md` (`praticas/10` §8). **Brief sem classe declarada:** o roteamento fica restrito à lista de um elemento do runtime nativo, que é o comportamento de hoje, até a classe ser declarada.
- Os filtros de classe são duros (§2, motivo 1). A decisão de fallback não oferece a entrada filtrada, e nenhuma resposta humana no fluxo a libera. Liberar exige registrar a avaliação §5, trabalho do Tech Lead fora da task.
- Em gateway, a avaliação §5 cobre o gateway **e** os hospedeiros que ele pode usar. A política de dados por requisição (§4) é o que prende o roteamento interno do gateway à avaliação.

### 9. Interação com o `playbook-task.js` (ADR-005) e com o frontmatter

- **O script é o caso de um provedor.** Os `agentType` sufixados (`architect-opus`, `planner-sonnet`, `spec-writer-opus`, `coder-sonnet`, `tester-sonnet`, `reviewer-opus`, `security-sre-fable`; nomes do ADR-010) equivalem cada um à lista `[claude-code:<model: do frontmatter>]`. O script continua válido sem mudança.
- **O script não faz fallback entre provedores.** Um limite no runtime nativo faz o run falhar. O script já trata agente sem retorno devolvendo `blocked` ("sem retorno"), e a decisão seguinte é humana. Se `.claude/routing.yaml` tiver listas com vários provedores, o script executa só a entrada nativa que corresponde ao `agentType`. As demais são inelegíveis para ele (`executor_incapaz`). O script nunca simula outro provedor.
- **Executar outros provedores exige outro executor**, fora do runtime nativo. Pela regra do ADR-005, ele só é conforme com API key ou sob exceção formal registrada em ADR do projeto. **Este ADR não autoriza, sozinho, orquestração externa.**
- **Ponteiro no script:** o schema `POINTER` não declara `additionalProperties: false`, então aceita `provider` e `needs_human` sem quebrar. Declará-los como propriedades opcionais do schema fica para a mudança que ativar o roteamento no script (zona protegida, Tech Lead).
- **Frontmatter em outros runtimes.** O `model:` do frontmatter é a entrada preferida do runtime nativo e não deve ser o mecanismo de seleção de modelo em outro runtime: o executor passa a entrada roteada explicitamente no lançamento. Há runtime de terceiro cuja documentação diz que lê `.claude/agents/` e respeita o campo `model`. `[VERIFICAR-EMPÍRICO]`: a precedência entre a flag de modelo do lançamento e o frontmatter, em cada runtime. **Degradação:** se o frontmatter prevalecer, a autoverificação (§5) e a conferência do medido acusam a divergência e bloqueiam. Nunca passa em silêncio.
- **Nome sufixado:** o sufixo do `name:` (ADR-001) continua indicando a entrada nativa preferida. As listas não mudam nomes nem `artifact_path`.

## Alternativas consideradas

1. **Manter só o ADR-001 e tratar a troca como exceção manual.** Não exige nada novo, mas cada limite de cota vira parada total. A troca feita "na mão" fica fora do ponteiro, que é exatamente a troca silenciosa que se quer impedir. Rejeitada.
2. **Campo novo no frontmatter de cada agente (`routing:`)**. A lista ficaria junto do agente, mas o frontmatter é formato de um runtime, e outros runtimes o leem com semântica própria (§9). O efeito de um campo desconhecido não está verificado. E uma mudança de política de fallback tocaria os 13 arquivos. Rejeitada em favor de um arquivo único.
3. **Lista só na configuração do orquestrador externo.** Mais simples para ele, mas o playbook perde a fonte da verdade versionada que o auditor lê, e o caso de um provedor deixa de ter referência escrita. Rejeitada. O orquestrador pode ter camada própria, desde que registre a lista efetiva (§1, §7).
4. **Família ou alias nas entradas.** Dispensa manutenção a cada versão, mas a revisão de 2026-09-23 do ADR-001 já rejeitou esse caminho para os gates, e um roteador automático tira o modelo efetivo do alcance da autoverificação. Rejeitada.
5. **Fallback automático para qualquer entrada, inclusive API.** Máxima continuidade, mas gasto sem teto nem confirmação, e fere a regra do ADR-005 de que API exige orçamento e decisão. Rejeitada. API automática só por papel, com orçamento.
6. **Diversidade obrigatória nos gates.** Garantiria segunda opinião, mas travaria o fluxo sempre que só um provedor estivesse pronto. Rejeitada como padrão; fica disponível como `require`.
7. **Desligar a autoverificação quando houver roteamento.** Resolveria o bloqueio do fallback, mas reabriria o downgrade silencioso que a camada 2 do ADR-001 existe para impedir. Rejeitada. A redefinição do §5 preserva a trava e muda só a referência.

## Consequências

**Positivas:** o fluxo segue quando uma assinatura se esgota, sem perder rastreabilidade; os gates podem ter segunda opinião real (de outro provedor e de outro modelo); cada run declara onde rodou, e o executor confere; o ADR-001, os agentes e o `playbook-task.js` continuam válidos sem mudança; a API fica sempre atrás de orçamento e, por padrão, de confirmação humana.

**Negativas / mitigação:**
- **Qualidade heterogênea no fallback.** A entrada seguinte pode ser menos capaz. Mitigação: as listas são governança do Tech Lead, e o gate continua obrigatório em qualquer entrada.
- **Mais subprocessadores de dado.** Mitigação: filtro duro por classe (§8).
- **Custo de API.** Mitigação: orçamento obrigatório em três janelas, teto por run e automático desligado por padrão (§4).
- **Dependência do que cada runtime expõe** (sinal de limite, modelo efetivo). Mitigação: `[VERIFICAR-EMPÍRICO]` com degradação segura: sem sinal, não há fallback automático; sem modelo verificável, a entrada não serve para gate.
- **Mais uma peça a manter** (`.claude/routing.yaml`, validação, normalização, equivalências). Mitigação: o arquivo é opcional, e a ausência é o caso de um provedor.
- **A linha da delegação vira contrato.** Um executor com defeito poderia informar a entrada errada. Mitigação: a conferência roteado × medido × declarado é feita por código fora do agente (§5), e a pertença à lista é checada pelo agente quando o arquivo está no worktree.
- **Consumidores do ponteiro** passam a tratar `provider` ausente como `claude-code`.

**Risco aceito:** confiança média até o primeiro fallback real entre provedores e a verificação empírica dos sinais de limite de cada runtime usado.

**Mudanças derivadas quando aceito** (fora deste PR, todas em zona protegida ou 🔒):
- Criar `.claude/routing.yaml` só quando houver o segundo provedor aprovado, e incluí-lo na zona protegida.
- Na seção "Modelo designado (ADR-001)" dos agentes, acrescentar: "ou a entrada roteada informada na delegação (ADR-007 §5)".
- Declarar `provider` e `needs_human` como opcionais no `POINTER` do `playbook-task.js`.
- Registrar na linha "Provedor/modelos 🔒" da `praticas/00`, para cada provedor, a classe máxima de dado e a avaliação §5.
- Coluna de roteamento na tabela da `DESENVOLVIMENTO-COM-IA` §3.

## Revisão

Trimestral, junto com o ADR-001: a revisão passa a cobrir também as listas e as equivalências. Revisão imediata se:
- um runtime mudar o sinal de limite ou a forma de expor o modelo;
- a política de uso de alguma assinatura mudar;
- mais de 30% dos runs de um trimestre rodarem fora da primeira entrada (a lista ou a cota está errada);
- um veredito de gate for anulado por divergência.

## Questões para a espinha

1. **Campos do ponteiro em dois PRs.** Os campos `provider` e `needs_human` do §3.2 entraram neste PR. O plano anterior os punha no PR do contrato de telemetria, junto com o schema `POINTER`. Aquele PR não deve reinseri-los no protocolo: fica só com o schema, ou faz rebase sobre este.
2. **Valor reservado `nao-exposto` em `model`** (§5). Este PR não altera o §3.2 nesse ponto. Se aceito, entra no §3.2, e o comparador de divergência do executor não deve tratá-lo como divergência.
3. **Pontos que o executor precisa refletir:**
   - veredito de gate dado em modelo divergente é anulado, não apenas alertado;
   - entrada não verificável é inelegível para gate (motivo `modelo_nao_verificavel`);
   - a diversidade exige modelo não equivalente, além de provedor diferente (`equivalencias`);
   - fallback para outro modelo do mesmo provedor sempre passa por decisão humana.
