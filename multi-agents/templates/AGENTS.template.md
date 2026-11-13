# AGENTS.md — modelo para o repositório do projeto

> Modelo. Copie para a raiz do repo do projeto como `AGENTS.md` (ou acrescente ao que já existe) e mantenha as seções abaixo.
> O resto do `AGENTS.md` (stack, comandos, convenções) é do projeto; esta parte vem do playbook (`docs/ADR-012`).

## Portal de gestão

O portal (`gestao/`, `http://localhost:4317`) é somente leitura e mostra o que está em `gestao/projeto.json`, em `docs/adr/`, em `tasks/` e na telemetria. Subir, ver e parar (Windows, macOS e Linux): `node gestao/painel.mjs iniciar | status | parar`. Guia: `gestao/README.md`. `gestao/projeto.json` é **dado do projeto**: o `playbook-update` nunca o sobrescreve.

1. **Atualize na mesma entrega.** Ao concluir cada fase, sessão ou item relevante, atualize `gestao/projeto.json`: status dos itens e da fase (`feito`, `andamento`, `pendente`, `bloqueado`; este com `bloqueio_id`), bloqueios, pendências manuais, aprovações e `atualizado`.
2. **Decisão com opções que depende do dev: pergunte, não liste.** Faça a pergunta ao dev na conversa, com a ferramenta de pergunta com opções e a recomendada primeiro. Enquanto não houver resposta, a pergunta fica em `decisoes` **sem** `resposta` (o portal a destaca como "aguardando sua resposta", com as opções). Depois da resposta, registre em `decisoes` (`resposta`, `por`, `data`, `registro`) e no ADR correspondente (`Status` e as seções Decisão e Consequências).
3. **Bloqueio novo = entrada em `bloqueios`** com `id`, `titulo`, `desde`, `gravidade`, `bloqueia`, `causa`, `resolver[]` (passo a passo), `pronto_quando`, `dono`, `arquivos[]` e `depende_de[]`. Os itens de fase apontam para ele por `bloqueio_id`. Ao resolver: remova o bloqueio, atualize os itens que apontavam para ele e as dependências (`depende_de`) dos outros.
4. **Telemetria ligada na máquina** (`node scripts/plano-assinatura.mjs --telemetria`, depois reiniciar o Claude Code): sem ela o portal não mostra o fluxo ao vivo nem os tokens por agente.
