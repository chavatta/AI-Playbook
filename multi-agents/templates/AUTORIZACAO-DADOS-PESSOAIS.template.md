# Autorização de dados pessoais — {cliente}

> Registro da **instrução do controlador (cliente) ao operador (nós)** para que dado pessoal comum entre no contexto de IA durante o desenvolvimento (`docs/ADR-011` D2, `praticas/10` §3.1).
> Gravado como `docs/autorizacoes/<cliente>-<AAAA-MM-DD>.md`. Escritor: **Tech Lead**. O documento assinado fica com o jurídico — aqui vai só o registro e onde está o original.
>
> **Não substitui** a base legal do tratamento (LGPD art. 7º), nem o consentimento do titular, nem o contrato com o provedor de IA (`praticas/10` §3, condição 2).
> **Nunca autoriza:** dado pessoal sensível (art. 5º II), dado de criança ou adolescente, credenciais. Esses seguem na classe Restrita.
> **Nunca escreva aqui dado de titular.** Nome e cargo de quem assina pelo cliente são o limite.

---

**Status:** vigente | revogada
**Validade:** AAAA-MM-DD
**Cliente (controlador):** {razão social}
**Operador:** {nossa empresa}
**Assinado por (cliente):** {nome} · {cargo} · AAAA-MM-DD
**Documento original:** {onde está — pasta do jurídico, sistema de contratos; nunca o arquivo neste repo}
**Ciência do DPO:** {nome} · AAAA-MM-DD

## Finalidade

{Para que o dado pode ser lido — ex.: "investigar divergência de saldo no módulo X". Finalidade genérica ("desenvolvimento") não vale.}

## Escopo

- **Sistemas e bases:** {quais}
- **Categorias de dado autorizadas:** {ex.: nome, e-mail, CPF, endereço}
- **Titulares:** {tipo — clientes finais, colaboradores…; nunca nomes}
- **Ambientes:** {produção somente leitura, cópia mascarada…}

## Provedores de IA autorizados (suboperadores)

| Provedor | Plano / conta | Região de processamento |
|---|---|---|
| {ex.: Anthropic} | {plano} | {país} |

## Condições de uso

- [ ] Execução local que devolve agregado é o padrão; trecho mínimo só quando o agregado não basta.
- [ ] Dado pessoal nunca vai para artifact, run-log, fixture, teste, log ou commit.
- [ ] Transcrições locais do Claude Code com o dado são apagadas em até {n} dias (`cleanupPeriodDays`).
- [ ] Incidente segue `docs/RUNBOOK-INCIDENTE-IA.md`, com aviso ao cliente em até {n} horas.

## Revogação

{Data e motivo, se revogada. Revogada não volta: autorização nova é registro novo.}
