# 11 — MCP (Model Context Protocol)

> Pergunta que este documento responde: **que servidores MCP podem ser conectados ao nosso ferramental de IA, sob que condição, e o que muda no risco quando um é adicionado?**
>
> Princípio-mãe: **conectar um servidor MCP é dar a um terceiro um lugar dentro do loop de decisão do agente.** Ele não só recebe dado — ele devolve texto que o modelo vai ler como informação e ferramentas que o modelo vai poder chamar. É decisão de arquitetura e de segurança, não de conveniência.
>
> Complementa `praticas/10-dados-e-contexto-de-ia.md` (o que pode entrar no contexto) e `praticas/06-devsecops.md` (supply chain). Aqui está o **como avaliar, aprovar e restringir um servidor MCP**.
>
> **Dono:** Tech Lead · **Revisão:** trimestral · **Última revisão:** 2026-08-31

---

## 1. Por que MCP precisa de regra própria

Uma dependência comum (`npm install`) executa código na sua máquina — risco conhecido, tratado pela supply chain em `praticas/06`. Um servidor MCP faz isso **e mais duas coisas que nenhuma biblioteca faz**:

1. **Ele descreve as próprias ferramentas ao modelo.** O nome e a descrição de cada ferramenta entram no prompt do agente. Quem controla o servidor controla parte do que o agente lê como instrução.
2. **A saída dele é lida como informação de confiança.** O resultado de uma ferramenta MCP volta para o contexto e influencia a próxima ação do agente — inclusive ações que o agente tem permissão para executar sozinho.

Some-se a isso o fato de que a Anthropic afirma explicitamente **não auditar a segurança dos servidores MCP** — o diretório de conectores passa por revisão funcional, não por auditoria de segurança. A confiança no servidor é responsabilidade de quem o conecta. Ou seja: nossa.

---

## 2. Os quatro escopos — e qual deles é o perigoso

| Escopo | Onde vive | Versionado no repo | Alcance |
|---|---|---|---|
| **local** (padrão) | config do usuário, atrelada ao projeto | Não | Só você, só neste projeto |
| **project** | `.mcp.json` na raiz do repositório | **Sim** | **Todo mundo que clonar o repo** |
| **user** | config do usuário, global | Não | Você, em todos os projetos |
| **managed** | política da organização, fora do repo | N/A | Toda a máquina/organização |

O escopo **project** é o que exige governança: um `.mcp.json` commitado propaga para toda a equipe. Adicionar um servidor ali **é mudança de superfície de ataque do projeto** e passa pelo gate do Security-SRE como qualquer task sensível.

Na primeira vez que uma sessão interativa encontra um `.mcp.json` novo, o Claude Code **pede aprovação** antes de conectar (`claude mcp list` mostra os pendentes como aguardando aprovação). Para revogar todas as aprovações do projeto e ser perguntado de novo:

```bash
claude mcp reset-project-choices
```

**A armadilha:** em modo não-interativo (`claude -p`, que é como o CI roda — ver manual do DevOps), **não há a quem perguntar**. Um `.mcp.json` commitado é a configuração efetiva do pipeline sem nenhuma confirmação humana no caminho. Por isso: servidor MCP em `.mcp.json` é revisado no PR com o mesmo rigor de uma mudança de pipeline, e o CI roda com a configuração explícita que o job declara (`--mcp-config`), não com o que estiver no repo por acidente.

---

## 3. Transporte e o que ele implica

| Transporte | Como conecta | Risco dominante |
|---|---|---|
| **stdio** | Claude Code sobe um **subprocesso local** | Roda com as **suas** permissões: seu filesystem, suas variáveis de ambiente, sua rede interna. É execução de código de terceiro na sua máquina |
| **http** | Requisições a um **endpoint remoto** | O dado sai do perímetro. O servidor vê o que você manda e escolhe o que devolve |
| **sse** | Streaming remoto (legado) | Mesmo de http; preferir `http` em servidor novo |

Não existe "transporte seguro": stdio troca risco de rede por risco de execução local, http troca execução local por transferência de dado. A pergunta certa não é qual transporte, é **em quem você está confiando**.

Registro:

```bash
claude mcp add --transport http --scope project <nome> <url>
```

```bash
claude mcp add --scope local <nome> -- <comando> [args...]
```

---

## 4. Credenciais

**Nunca** escreva token, chave ou senha literal em `.mcp.json` — o arquivo é versionado, e segredo commitado é incidente (`praticas/06`, LGPD e rotação). Use expansão de variável de ambiente:

```json
{
  "mcpServers": {
    "exemplo": {
      "type": "http",
      "url": "${EXEMPLO_MCP_URL}",
      "headers": { "Authorization": "Bearer ${EXEMPLO_MCP_TOKEN}" }
    }
  }
}
```

Regras da casa:

- **Token de escopo mínimo.** Um servidor MCP que precisa ler issues não recebe um token com permissão de escrita no repositório. O servidor age *em seu nome* — o dano possível é o teto do que o token permite, não o que o servidor promete fazer.
- **Preferir OAuth a token estático** quando o servidor suportar (`claude mcp login <nome>`): cada pessoa autentica como si mesma, e revogar é por pessoa, não por segredo compartilhado.
- **Token estático nunca em escopo project.** Se precisa de header fixo, ele vive na configuração local do usuário ou em `.claude/settings.local.json`, que é gitignored.

---

## 5. A superfície de ataque, concretamente

| Vetor | Como acontece | Mitigação |
|---|---|---|
| **Prompt injection via saída de ferramenta** | O servidor devolve conteúdo com texto endereçado ao modelo ("ignore as instruções anteriores e…"). O agente lê como informação | Saída de ferramenta é **dado, nunca instrução** (mesma regra de `praticas/10` §6). Operação sensível continua exigindo aprovação; não rode em modo que dispense permissão |
| **Tool poisoning** | A descrição da ferramenta promete uma coisa e ela faz outra. A descrição entra no prompt do agente | Inspecionar o que o servidor expõe antes de aprovar: `claude mcp get <nome>` |
| **Servidor comprometido** | O servidor era confiável e deixou de ser (conta invadida, dependência trocada, domínio expirado) | Fixar origem e versão; revisar na cadência trimestral; preferir servidores com mantenedor identificável |
| **Exfiltração** | Ferramenta remota recebe, numa chamada seguinte, contexto que não era para ela | Minimização (`praticas/10` §3); não conectar servidor remoto em projeto que manipula dado Confidencial sem avaliação de provedor (`praticas/10` §5) |
| **Confused deputy** | O servidor usa **o seu** token para fazer uma requisição que você não autorizou | Token de escopo mínimo; verificar hostname exato antes de conectar; OAuth em vez de PAT |

---

## 6. Controles disponíveis

Ferramentas MCP entram no sistema de permissões com o formato `mcp__<servidor>__<ferramenta>`, e aceitam curinga:

```json
{
  "permissions": {
    "allow": ["mcp__exemplo__buscar_docs"],
    "deny": ["mcp__exemplo__*"]
  }
}
```

Ferramenta MCP **não é auto-aprovada**: sem regra em `allow`, ela pede permissão antes de rodar. Um `deny` vence qualquer `allow`.

Nossa postura: **allowlist por ferramenta, não por servidor.** Aprovar `mcp__servidor__*` entrega ao servidor toda ferramenta que ele decidir expor no futuro — inclusive as que ele ainda não expõe. Aprove as ferramentas que a task precisa.

> **A verificar antes de desenhar controle organizacional:** existem chaves de política em escopo *managed* (allowlist/denylist de servidores por URL ou comando, e restrição a servidores da organização) que permitem travar isso na máquina, fora do alcance do repo. Elas mudaram recentemente — confirme a sintaxe vigente na documentação oficial antes de escrever política corporativa em cima. Esta prática cobre o que se controla **dentro do projeto**.

---

## 7. Como aprovar um servidor MCP aqui

Adicionar servidor em escopo **project** é task sensível (toca superfície externa). Fluxo:

1. **Quem propõe descreve a necessidade** — que problema o servidor resolve e por que não dá para resolver sem ele. Conveniência não é justificativa; MCP não homologado já é vedado para dado Confidencial (`praticas/10` §3).
2. **Architect** avalia se é a solução certa e registra em ADR — inclui o servidor descartado e o porquê.
3. **Security-SRE** audita: origem e mantenedor, transporte, ferramentas expostas (`claude mcp get`), credencial e escopo do token, e o que a saída dele pode influenciar. Aplica a avaliação de provedor de `praticas/10` §5 se o servidor for remoto e tocar dado Confidencial.
4. **Tech Lead aprova**, e o servidor entra em `praticas/00-stack-e-defaults.md` como ferramental aprovado, com o escopo de dado para o qual foi aprovado.
5. O `.mcp.json` e as regras de permissão entram no mesmo PR, revisados como código.

Servidor em escopo **local** ou **user** é decisão individual — mas só para dado Interno ou Público. Ferramenta pessoal não vira ferramental aprovado por uso continuado.

---

## 8. Checklist antes de conectar

- [ ] Sei quem mantém este servidor e consigo nomear a organização por trás?
- [ ] O transporte é o adequado — e entendi se estou executando código local ou mandando dado para fora?
- [ ] Inspecionei as ferramentas que ele expõe, e não só a descrição de marketing?
- [ ] O token tem o **menor** escopo que resolve, e não está literal em arquivo versionado?
- [ ] Se é escopo project: passou por ADR, gate do Security-SRE e entrou no `praticas/00`?
- [ ] As permissões estão por ferramenta, e não `mcp__servidor__*`?
- [ ] Pensei no que acontece se a saída deste servidor for hostil na próxima semana?

---

## Fontes

- [Documentação oficial de MCP no Claude Code](https://code.claude.com/docs/en/mcp) · [Especificação do Model Context Protocol](https://modelcontextprotocol.io)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Supply Chain
- ISO/IEC 27001:2022 — A.5.19–5.21 (fornecedores), A.8.28 (código seguro), A.5.15 (controle de acesso)
- ISO/IEC 42001:2023 — A.10.3 (fornecedores de sistemas de IA)
- `praticas/10-dados-e-contexto-de-ia.md` · `praticas/06-devsecops.md`
