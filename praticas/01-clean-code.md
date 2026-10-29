# 01 — Clean Code

> Pergunta que este documento responde: **como escrever código que o próximo dev (humano ou agente) entende e modifica com segurança?**
>
> Princípio-mãe: código é lido dezenas de vezes mais do que é escrito. Otimize para o leitor.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## Os fundamentos (o consenso do mercado)

### 1. Nomes revelam intenção
- Um nome bom elimina o comentário: `elapsedDays` em vez de `d // dias`.
- Funções são verbos (`sendInvoice`), booleanos são perguntas (`isExpired`, `hasAccess`), classes/módulos são substantivos.
- Se você precisa abrir a função para saber o que ela faz, o nome falhou.
- Evite nomes que mentem: `getUser()` que também cria o usuário é um bug de comunicação.

### 2. Funções pequenas, com uma responsabilidade
- Uma função faz **uma coisa** no **mesmo nível de abstração**. Misturar regra de negócio com formatação de string é sinal de corte errado.
- Poucos parâmetros (0–3). Acima disso, agrupe em um objeto com nome.
- Sem efeitos colaterais escondidos: uma função chamada `validate()` não grava no banco.

### 3. Erro é caminho de primeira classe
- Trate erros com tipos específicos, na camada certa; nunca `catch` vazio, nunca `throw new Error('fail')`.
- Falhe cedo e alto em bugs de programação; falhe graciosamente em erros esperados (rede, input do usuário).
- Não retorne `null` quando pode retornar um tipo que força o tratamento (`Result`, `Optional`, união discriminada).

### 4. Comentários explicam o PORQUÊ, nunca o quê
```typescript
// bcrypt custo 12 (não o default 10): usuários são alvo de alto valor
// e os ~300ms extras aumentam a resistência a brute force.
const hash = await bcrypt.hash(password, 12);
```
- Comentário que parafraseia o código é ruído e envelhece mal.
- Comentário bom registra: decisão não-óbvia, workaround com razão, constraint externa.

### 5. Duplicação: regra dos 3, não DRY-cego
- Duplicar 2x é aceitável; na 3ª ocorrência, extraia.
- **A abstração errada custa mais que a duplicação.** Só unifique código que muda pelas mesmas razões — semelhança de forma não é semelhança de motivo.

### 6. Simplicidade > cleverness (KISS / YAGNI)
- A solução mais simples que passa nos critérios de aceitação vence.
- Não construa para requisitos imaginários ("vamos precisar disso depois") — YAGNI. Generalize quando o segundo caso real aparecer.
- One-liners "espertos" ilegíveis são dívida, não elegância.

### 7. Consistência com a codebase vence preferência pessoal
- Siga os padrões existentes (imports, naming, camadas, error handling) mesmo quando discordar.
- Quer mudar o padrão? Proponha a mudança separadamente (ADR ou task própria) — não misture reforma de estilo com feature.

### 8. Boy Scout Rule — com escopo
- Deixe o código que você **tocou** um pouco melhor do que encontrou.
- Mas dentro do escopo da task: refactor oportunista que incha o diff sabota o review (`GOVERNANCE.md §2` — PRs de ~200–400 linhas).

---

## SOLID em uma linha cada (para OO e módulos em geral)

| Princípio | Em uma frase |
|-----------|--------------|
| **S**ingle Responsibility | Um módulo muda por **uma** razão — uma parte interessada por módulo |
| **O**pen/Closed | Estenda por composição/novas implementações, não editando o núcleo estável |
| **L**iskov Substitution | Subtipo honra o contrato do tipo base — sem surpresas para quem consome |
| **I**nterface Segregation | Interfaces pequenas e específicas; ninguém depende do que não usa |
| **D**ependency Inversion | Dependa de abstrações; detalhes (banco, HTTP) ficam na borda |

---

## Sinais de alerta (code smells que o Reviewer procura)

- Função com mais de ~40 linhas ou mais de 2 níveis de indentação aninhada.
- Parâmetro booleano de controle (`doStuff(true)`) — separe em duas funções.
- Classe/módulo "Utils" que vira depósito de tudo.
- Dados e comportamento separados que sempre andam juntos (feature envy).
- Comentário explicando um bloco — o bloco queria ser uma função com nome.
- `any`/cast sem justificativa; supressão de lint sem comentário do porquê.

---

## Checklist rápido (auto-verificação do Coder)

- [ ] Nomes revelam intenção; nenhum nome mente.
- [ ] Cada função: uma responsabilidade, um nível de abstração.
- [ ] Erros tratados com tipos específicos na camada certa.
- [ ] Comentários só de "porquê"; zero paráfrase.
- [ ] Sem abstração especulativa (YAGNI); sem duplicação de 3ª ocorrência.
- [ ] Padrões da codebase seguidos.
- [ ] Diff dentro do escopo da task.

---

## Fontes

- Robert C. Martin — *Clean Code* (nomes, funções, comentários, erro)
- John Ousterhout — *A Philosophy of Software Design* (deep modules, complexidade como custo #1)
- Martin Fowler — *Refactoring* (code smells, regra dos 3)
- Sandi Metz — ["The Wrong Abstraction"](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)
