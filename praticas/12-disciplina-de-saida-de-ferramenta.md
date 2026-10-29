# 12 — Disciplina de saída de ferramenta

> Pergunta que este documento responde: **o que um agente pode trazer para o próprio contexto, e em que tamanho?**
>
> Princípio-mãe: **todo token que entra no contexto é relido em toda chamada seguinte.** Um log de 20 k tokens lido na chamada 10 de uma execução de 50 chamadas custa 40 releituras. O que encarece uma execução longa não é o que o agente escreve, é o que ele carrega.
>
> Decisão e medição: [`docs/ADR-009`](../docs/ADR-009-eficiencia-de-contexto-e-cache.md). Limiares: bloco `orcamento-contexto` do [00](00-stack-e-defaults.md) (perfil do projeto). Complementa o [10](10-dados-e-contexto-de-ia.md), que decide **o que pode** entrar; este decide **quanto**.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-09-29

---

## Resumo

1. Teste, lint e análise estática: **só falhas e resumo** (`scripts/quiet/`).
2. **Busque antes de ler.** Leia por faixa de linhas.
3. Arquivo acima de `leitura_max_linhas_sem_justificativa` (default 400): **não** leia inteiro sem dizer por quê.
4. Log completo, lockfile, arquivo gerado, minificado ou binário: **nunca** no contexto.
5. Saída acima de `saida_para_arquivo_linhas` (default 150): **vai para arquivo** em `tasks/{id}/artifacts/` e você lê o trecho.
6. Comando longo (acima de `background_acima_segundos`, default 180 s): **background com consulta curta, ou timeout explícito**.

---

## 1. Teste, lint e análise estática em modo quiet

Rode pelos wrappers, não pelo comando cru:

```bash
node scripts/quiet/test-quiet.mjs --task <task_id>
node scripts/quiet/lint-quiet.mjs --task <task_id>
node scripts/quiet/analise-quiet.mjs --task <task_id>
```

- O comando de cada um vem de `comandos_quiet` no perfil do projeto (00). Campo vazio → o wrapper recusa e diz onde preencher. Para um comando avulso: `node scripts/quiet/run-quiet.mjs teste -- <comando>`.
- O wrapper mostra as linhas de falha (e a linha seguinte, que costuma trazer arquivo e linha) mais o resumo final, até `quiet_max_linhas`. A saída completa fica em `tasks/{id}/artifacts/<tipo>-<hora>.log`.
- O código de saída é o do comando: falhou é falhou.
- Onde a ferramenta já tem modo silencioso (reporter de falhas, `--quiet`, `-q`), configure-o **no** `comandos_quiet` — o wrapper é a rede de segurança, não o substituto.

**Quando não:** o Debugger reproduzindo um bug pode precisar de uma saída verbosa. Rode-a com a saída para arquivo e leia o trecho (§4).

## 2. Buscar antes de ler

- `rg -n <padrão>` (ou `grep -rn`) acha o lugar; a leitura vem depois, **por faixa** (`offset`/`limit` na ferramenta de leitura, `sed -n 'A,Bp'` no shell).
- Arquivo acima do limiar lido inteiro exige uma frase de justificativa no artifact ("refatoração do módulo inteiro", por exemplo). Sem justificativa, é desperdício.
- Releitura do mesmo trecho na mesma execução: não. Se o trecho importa, anote no artifact ou no checkpoint.

## 3. O que nunca entra no contexto

| Nunca | Em vez disso |
|---|---|
| Log completo de CI, servidor ou teste | `rg` pelo erro no arquivo de log; leia a faixa em volta |
| Lockfile (`*.lock`, `package-lock.json`, `go.sum`…) | Pergunte à ferramenta (`npm ls <pacote>`, `uv tree`, `go mod why`) |
| Arquivo gerado (build, cliente gerado de OpenAPI, migração autogerada, snapshot grande) | Leia a **fonte** que o gera |
| Minificado, bundle, mapa de fonte | Leia a fonte |
| Binário, imagem, dump de banco | Metadado (`file`, `wc -c`, `ls -l`) |
| Diff inteiro de um PR grande | `git diff --stat`, depois arquivo a arquivo |

## 4. Saída longa vai para arquivo

Comando com saída esperada acima de `saida_para_arquivo_linhas`:

```bash
<comando> > tasks/<task_id>/artifacts/<nome>.log 2>&1; echo "código $?"; wc -l tasks/<task_id>/artifacts/<nome>.log
```

Depois, `rg -n` no arquivo e leitura por faixa. O arquivo é evidência da task; o contexto fica com o trecho.

## 5. Comando longo

O cache de um subagente vive **5 minutos**, contados do início da chamada. Um comando que prende o agente por mais que isso faz a chamada seguinte **reescrever o contexto inteiro** — foi o padrão dos piores casos de cache quebrado.

- Duração esperada acima de `background_acima_segundos`: rode em **background** e consulte a saída a cada `polling_segundos`. Cada consulta é uma releitura barata que mantém o cache vivo.
- Sem background disponível: **timeout explícito** no comando, abaixo de `sem_chamada_max_segundos`, e divida o trabalho (subconjunto de testes, um pacote por vez).
- Nunca fique mais de `sem_chamada_max_segundos` sem chamada ao modelo.

Validado no harness: `run_in_background` com leitura posterior da saída e `timeout` explícito (`scripts/smoke-harness.mjs`, M4 e M5).

## 6. O aviso do hook

O hook `context-budget.mjs` (em produção desde 2026-09-29) acrescenta uma nota `[orçamento de contexto]` depois do resultado de ferramenta que passar de `aviso_resultado_tokens`. Ele **não bloqueia**: a nota é para você corrigir a próxima chamada, e o registro serve para medir adesão. Sem o hook, esta prática vale do mesmo jeito — o prompt de todo agente do `/task` a repete.

---

## Checklist do agente

- [ ] Teste/lint/análise pelo `*-quiet`
- [ ] Busquei antes de ler; li por faixa
- [ ] Nenhum arquivo acima do limiar lido inteiro sem justificativa no artifact
- [ ] Nada da tabela do §3 no contexto
- [ ] Saída longa em `artifacts/`, lida por trecho
- [ ] Comando longo em background ou com timeout

## Fontes

- `docs/ADR-009-eficiencia-de-contexto-e-cache.md` — problema, decisões e plano de medição
- Documentação de prompt caching da Anthropic — prefixo, TTL de 5 min e 1 h, preço de escrita e releitura
