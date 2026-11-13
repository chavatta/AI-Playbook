# Portal de gestão

Painel local do projeto, igual para qualquer projeto que adote o playbook (`docs/ADR-012`). Mostra, num só lugar: etapas e progresso, bloqueios com o passo a passo para resolver, decisões aguardando você, ADRs, o fluxo da execução em curso (agentes, modelo e esforço), tokens e custo, telemetria e tasks.

Zero dependências. Exige só **Node.js ≥ 18**. Somente leitura. Escuta apenas em `127.0.0.1`.

## Subir e parar (Windows, macOS e Linux)

O mesmo comando funciona nos três sistemas, na raiz do repo:

```bash
node gestao/painel.mjs iniciar   # sobe em segundo plano; se já está no ar, só informa
node gestao/painel.mjs status    # diz se está no ar
node gestao/painel.mjs parar     # encerra
```

Depois abra <http://localhost:4317>. O painel roda **fora da sessão do Claude Code**: fechar o Claude Code não o derruba. Os comandos são idempotentes e não registram tarefa agendada nem mudam o sistema; se quiser que ele suba no login, isso é escolha sua, fora do repo.

Atalhos equivalentes (só chamam o `painel.mjs`): `powershell -File gestao/iniciar.ps1` / `parar.ps1` no Windows, `sh gestao/iniciar.sh` / `parar.sh` no macOS e Linux.

Para ver o log ou depurar, rode em primeiro plano: `node gestao/serve.mjs`.

| Variável | Uso | Padrão |
|---|---|---|
| `GESTAO_PORT` | porta do portal (`0` = uma livre, só com `serve.mjs`) | `4317` |

## O que alimenta cada seção

| Seção | Fonte |
|---|---|
| Etapas, bloqueios, decisões, pendências, aprovações | `gestao/projeto.json` (dado do projeto) |
| Aprovações/ADRs | `docs/adr/*.md` e `docs/ADR-*.md` (título e linha `**Status:**`) |
| Tasks e bloqueios de task | `tasks/*/brief.md` e `run-log.md` |
| Fluxo, agentes, feed de eventos | telemetria: `tasks/*/telemetry.jsonl` e `.claude/telemetry-spool.jsonl`; sem ela, o fluxo é reconstruído do `run-log.md` |
| Modelo e esforço dos agentes | telemetria; senão `.claude/agents/*.md` (marcado com `*`, "configurado") |
| Tokens e custo | `scripts/telemetria/relatorio-custos.mjs --json` (transcrições do Claude Code) e eventos `usage.report` |

Sem `docs/adr`, sem tasks, sem telemetria ou sem `projeto.json`, o portal sobe e mostra estados vazios. Sem `projeto.json`, ele o cria a partir de `gestao/projeto.template.json`.

## Ligar a telemetria (uma vez por máquina)

Sem telemetria o portal funciona, mas sem fluxo ao vivo nem tokens por agente.

```bash
node scripts/plano-assinatura.mjs --telemetria
```

Isso grava `PLAYBOOK_TELEMETRY_URL=spool` e `PLAYBOOK_PROJECT_ID` em `.claude/settings.local.json` (não versionado). Reinicie o Claude Code. Confira com `--verificar-telemetria`.

## `gestao/projeto.json`: o que preencher

É **dado do projeto**: o `playbook-update` nunca o sobrescreve. O arquivo que vem no playbook é só um exemplo: troque `nome`, fases e pendências pelos reais.

- `fases[]`: `id`, `nome`, `status` e `itens[]` com `t` (texto) e `s` (`feito`, `andamento`, `pendente`, `bloqueado`; este com `bloqueio_id`).
- `bloqueios[]`: `id`, `titulo`, `desde`, `gravidade` (`alta`, `media`, `baixa`), `bloqueia`, `causa`, `resolver[]` (passo a passo), `pronto_quando`, `dono`, `arquivos[]`, `depende_de[]`.
- `decisoes[]`: `id`, `pergunta`, `opcoes[]`; ao responder, `resposta`, `por`, `data`, `registro`. Sem `resposta` aparece como "aguardando sua resposta".
- `aprovacoes[]`, `pendencias_manuais[]`, `atualizado`.

Quem mantém é o agente, na mesma entrega de cada fase. As regras (perguntar em vez de listar opções, registrar a resposta no ADR, bloqueio novo com passo a passo) estão em `multi-agents/templates/AGENTS.template.md`: copie a seção "Portal de gestão" para o `AGENTS.md` do projeto.

## Problemas comuns

- **"Porta em uso"**: já há um portal rodando (`status`) ou outro programa usa a 4317; use `GESTAO_PORT=4400 node gestao/painel.mjs iniciar`.
- **Página diz "sem conexão"**: o portal não está no ar; rode `iniciar`.
- **Telemetria "desligada"**: faça o passo acima e reinicie o Claude Code.
- **Aviso sobre `projeto.json` inválido**: o JSON está quebrado; o portal mostra o que conseguiu ler.
