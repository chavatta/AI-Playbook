#!/usr/bin/env node
// PreToolUse/Write|Edit — impede o agente de alterar as próprias travas e a governança.
// Cobre caminhos absolutos e caminhos Windows (barra invertida), que o deny
// relativo do settings.json não pega. Multiplataforma — mesma lógica do protect-guardrails.sh.
// exit 2 = bloqueia.

import { readFileSync } from "node:fs";

let fp = "";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  fp = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? "";
} catch {
  process.exit(0);
}

// normaliza separadores do Windows para comparar com um padrão só
const p = String(fp).replace(/\\/g, "/");

const block = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(2);
};

// pasta protegida: relativa ("dir/…") ou em qualquer profundidade ("…/dir/…")
const inDir = (dir) => p.startsWith(dir + "/") || p.includes("/" + dir + "/");

if (p === ".claude/settings.json" || p.endsWith("/.claude/settings.json")) {
  block("BLOQUEADO: '.claude/settings.json' contém as travas do playbook e não pode ser alterado por agentes. Mudanças aqui são do Tech Lead (GOVERNANCE.md §6).");
}
if (inDir(".claude/hooks")) {
  block("BLOQUEADO: hooks são as travas mecânicas do playbook e não podem ser alterados por agentes (GOVERNANCE.md §6).");
}
// O script do fluxo é quem devolve `done` (ADR-005): alterá-lo é alterar o gate.
if (inDir(".claude/workflows")) {
  block("BLOQUEADO: .claude/workflows/ contém o fluxo que decide o gate (ADR-005) e não pode ser alterado por agentes. Proposta de mudança vai para docs/patches/ (GOVERNANCE.md §6).");
}
// A definição do agente fixa tools e modelo — o agente não reescreve a própria permissão.
if (inDir(".claude/agents")) {
  block("BLOQUEADO: .claude/agents/ define tools e modelo de cada agente e não pode ser alterado por agentes. Proposta de mudança vai para docs/patches/ (GOVERNANCE.md §6).");
}
if (p === "GOVERNANCE.md" || p.endsWith("/GOVERNANCE.md")) {
  block("BLOQUEADO: GOVERNANCE.md é a lei do playbook — só o Tech Lead altera (GOVERNANCE.md §6).");
}

process.exit(0);
