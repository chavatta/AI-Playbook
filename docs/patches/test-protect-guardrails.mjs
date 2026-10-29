#!/usr/bin/env node
// Banco de casos para protect-guardrails.mjs.
// Uso: node test-protect-guardrails.mjs <caminho-do-hook>
import { spawnSync } from "node:child_process";

const HOOK = process.argv[2];

// [descricao, tool_input, esperado] — BLOCK = deve bloquear, ALLOW = deve passar
const CASES = [
  // ---- zona protegida vigente ----
  ["settings relativo",           { file_path: ".claude/settings.json" }, "BLOCK"],
  ["settings absoluto",           { file_path: "/Users/u/repo/.claude/settings.json" }, "BLOCK"],
  ["settings Windows",            { file_path: "C:\\repo\\.claude\\settings.json" }, "BLOCK"],
  ["hook relativo",               { file_path: ".claude/hooks/x.mjs" }, "BLOCK"],
  ["hook absoluto",               { file_path: "/home/u/repo/.claude/hooks/block-dangerous-git.mjs" }, "BLOCK"],
  ["GOVERNANCE relativo",         { file_path: "GOVERNANCE.md" }, "BLOCK"],
  ["GOVERNANCE absoluto",         { file_path: "/home/u/repo/GOVERNANCE.md" }, "BLOCK"],
  // ---- zona nova (ADR-005) ----
  ["workflow relativo",           { file_path: ".claude/workflows/playbook-task.js" }, "BLOCK"],
  ["workflow absoluto",           { file_path: "/home/u/repo/.claude/workflows/playbook-task.js" }, "BLOCK"],
  ["workflow Windows",            { file_path: "C:\\repo\\.claude\\workflows\\playbook-task.js" }, "BLOCK"],
  ["agente relativo",             { file_path: ".claude/agents/reviewer.md" }, "BLOCK"],
  ["agente absoluto",             { file_path: "/home/u/repo/.claude/agents/coder.md" }, "BLOCK"],
  ["notebook em agents",          { notebook_path: ".claude/agents/x.ipynb" }, "BLOCK"],
  // ---- deve PASSAR ----
  ["skill de projeto",            { file_path: ".claude/skills/deploy/SKILL.md" }, "ALLOW"],
  ["settings.local.json",         { file_path: ".claude/settings.local.json" }, "ALLOW"],
  ["worktree do Claude Code",     { file_path: ".claude/worktrees/x/src/a.ts" }, "ALLOW"],
  ["patch proposto",              { file_path: "docs/patches/GOVERNANCE.proposto.md" }, "ALLOW"],
  ["hook proposto",               { file_path: "docs/patches/protect-guardrails.mjs" }, "ALLOW"],
  ["manual do agente",            { file_path: "multi-agents/agents/04-reviewer.md" }, "ALLOW"],
  ["pasta agents fora de .claude",{ file_path: "src/agents/router.ts" }, "ALLOW"],
  ["workflows fora de .claude",   { file_path: ".github/workflows/ci.yml" }, "ALLOW"],
  ["artifact de task",            { file_path: "tasks/2026-09-23_x/artifacts/reviewer.md" }, "ALLOW"],
];

let pass = 0, fail = 0;
const failures = [];

for (const [desc, tool_input, want] of CASES) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_input }),
    encoding: "utf8",
  });
  const got = r.status === 2 ? "BLOCK" : "ALLOW";
  if (got === want) pass++;
  else { fail++; failures.push(`  [${want} esperado, veio ${got}]  ${desc}  ::  ${JSON.stringify(tool_input)}`); }
}

console.log(HOOK);
console.log(`  passou: ${pass}/${CASES.length}   falhou: ${fail}`);
if (failures.length) console.log(failures.join("\n"));
