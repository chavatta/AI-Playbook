# 08 — Design Funcional

> Pergunta que este documento responde: **como usar os princípios de programação funcional para reduzir bugs — em qualquer linguagem, sem virar academicismo?**
>
> Princípio-mãe: **a maioria dos bugs difíceis vive em estado mutável compartilhado e efeitos colaterais escondidos.** Design funcional é minimizar e isolar essas duas coisas — não é sobre usar Haskell.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## Os princípios (aplicáveis em TS, Python, Go, Java…)

### 1. Funções puras por padrão
- Mesma entrada → mesma saída, sem efeito colateral. Puro é trivial de testar (sem mock), de paralelizar e de raciocinar.
- Efeito (IO, banco, clock, random) é **explícito e empurrado para a borda** — nunca escondido no meio de um cálculo.

### 2. Functional Core, Imperative Shell (o padrão-síntese)
```
[shell imperativo]  busca dados → [core funcional] decide (puro) → [shell] executa efeitos
```
- O **core** contém as decisões de negócio como funções puras: recebe dados, retorna *o que fazer* (valor/decisão).
- O **shell** fino faz IO: lê do banco, chama o core, grava/envia o que o core decidiu.
- Casa direto com Clean Architecture ([07](07-clean-architecture.md)): core funcional ≈ domínio; shell ≈ adapters.
- Resultado prático: testes de regra de negócio sem mock; mocks só nos testes do shell (que são poucos).

### 3. Imutabilidade por padrão
- Dados são valores: transformar cria novo valor, não muta o existente (`const`, `readonly`, records, `frozen dataclass`, spread/`with`).
- Mutação local dentro de uma função (por performance/clareza) é aceitável — o que não pode é **compartilhar** referência mutável entre módulos.
- Elimina classes inteiras de bug: aliasing, race conditions, "quem mudou isso?".

### 4. Erros como valores, não como surpresa
- Operação que pode falhar de forma **esperada** retorna o erro no tipo (`Result<T, E>`, `Either`, união discriminada) — o chamador é forçado a tratar.
- Exceção fica para o inesperado (bug, invariante violada).
- Casa com a regra do Coder: happy-path-only é código incompleto.

### 5. Torne estados ilegais irrepresentáveis
- Modele com tipos que não permitem o inválido: em vez de `{ status: string, paidAt?: Date }`, uma união `Pending | Paid { paidAt } | Cancelled { reason }`.
- Parse, don't validate: valide na borda **uma vez** e converta para um tipo que carrega a garantia (`Email`, não `string` validada em 5 lugares).

### 6. Composição sobre herança
- Comportamento composto por funções pequenas (`pipe`/`compose`, higher-order functions) em vez de hierarquias de classe profundas.
- Herança de implementação raramente sobrevive à segunda mudança de requisito; composição se rearranja.

### 7. Declarativo sobre imperativo (na medida)
- `map/filter/reduce` sobre loops com acumuladores mutáveis, **quando ficar mais legível**.
- Se o encadeamento de 7 operadores ficou ilegível, um loop simples é o design funcional certo — legibilidade primeiro ([01-clean-code](01-clean-code.md), cleverness).

---

## Aplicação por linguagem (o pragmático)

| Linguagem | O que adotar já |
|-----------|-----------------|
| TypeScript | `readonly`, uniões discriminadas + narrowing, `Result` (ts-results/neverthrow ou próprio), funções puras no domínio |
| Python | `@dataclass(frozen=True)`, `match` em uniões, retorno `Ok/Err` próprio, evitar estado de módulo |
| Go | Erros como valores já é idioma; some structs imutáveis por convenção e funções puras no domínio |
| Java/Kotlin | Records/data classes, `sealed` para uniões, `Optional`/`Result`, streams com moderação |

---

## Sinais de alerta

- Função que lê/escreve variável de módulo ou singleton mutável.
- `void` que "faz coisas" — efeito sem nome no tipo.
- O mesmo objeto passado adiante e mutado por 3 camadas.
- Boolean/string status + campos opcionais que só valem em certos status (estado ilegal representável).
- Teste de regra de negócio que precisa de 6 mocks → a regra está enredada com efeitos; extraia o core puro.

## Checklist para Coder/Reviewer

- [ ] Regra de negócio em funções puras; IO na borda (core/shell).
- [ ] Dados imutáveis por padrão; nenhuma referência mutável compartilhada.
- [ ] Falha esperada no tipo de retorno; exceção só para o inesperado.
- [ ] Validação na borda produz tipos com garantia (parse, don't validate).
- [ ] Nenhum estado ilegal representável nos tipos novos.
- [ ] Declarativo onde clareia, imperativo onde clareia.

---

## Fontes

- Gary Bernhardt — ["Functional Core, Imperative Shell"](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) e "Boundaries"
- Scott Wlaschin — *Domain Modeling Made Functional* / [fsharpforfunandprofit](https://fsharpforfunandprofit.com/) (tipos que tornam estados ilegais irrepresentáveis)
- Alexis King — ["Parse, don't validate"](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
- Rich Hickey — ["Simple Made Easy"](https://www.infoq.com/presentations/Simple-Made-Easy/) (valor da imutabilidade e da simplicidade)
