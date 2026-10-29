#!/usr/bin/env node
// Banco de casos para check-reviewer-gate.mjs.
// Uso: node test-check-reviewer-gate.mjs <caminho-do-hook>
// Cada caso monta um tasks/ temporário e roda o hook com CLAUDE_PROJECT_DIR apontando para ele.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(process.argv[2]);

const DONE = "| 2026-09-23 10:00 | orchestrator | done | approved | - |\n";
const OPEN = "| 2026-09-23 10:00 | orchestrator | task_created | - | brief.md |\n";
const OK = "**Veredito:** APROVADO\n\n# Review\n";
const NOK = "**Veredito:** REPROVADO (2 issues)\n\n# Review\n";
const NOK_CITA = "**Veredito:** REPROVADO (1 issue)\n\nNa rodada anterior o artifact dizia:\n\n**Veredito:** APROVADO\n";
const SENS = "**Sensível (security gate):** sim — toca auth\n";
const NSENS = "**Sensível (security gate):** não\n";
const TEMPLATE = "**Sensível (security gate):** sim | não — toca auth…\n";

// [descricao, { task: { runlog, brief, reviewer, security } } | null, stdin, esperado]
// esperado: BLOCK (exit 2) ou ALLOW (exit 0)
const CASES = [
  ["sem pasta tasks/",                    null, {}, "ALLOW"],
  ["done + reviewer APROVADO",            { t: { runlog: DONE, brief: NSENS, reviewer: OK } }, {}, "ALLOW"],
  ["done sem reviewer.md",                { t: { runlog: DONE, brief: NSENS } }, {}, "BLOCK"],
  ["done + reviewer REPROVADO",           { t: { runlog: DONE, brief: NSENS, reviewer: NOK } }, {}, "BLOCK"],
  ["done + REPROVADO citando APROVADO",   { t: { runlog: DONE, brief: NSENS, reviewer: NOK_CITA } }, {}, "BLOCK"],
  ["aberta, sem reviewer",                { t: { runlog: OPEN, brief: NSENS } }, {}, "ALLOW"],
  ["sensível done, sem security",         { t: { runlog: DONE, brief: SENS, reviewer: OK } }, {}, "BLOCK"],
  ["sensível done, ambos APROVADO",       { t: { runlog: DONE, brief: SENS, reviewer: OK, security: OK } }, {}, "ALLOW"],
  ["sensível, security REPROVADO citando",{ t: { runlog: DONE, brief: SENS, reviewer: OK, security: NOK_CITA } }, {}, "BLOCK"],
  ["brief de template (sim | não)",       { t: { runlog: DONE, brief: TEMPLATE, reviewer: OK } }, {}, "ALLOW"],
  ["BOM e linha em branco antes",         { t: { runlog: DONE, brief: NSENS, reviewer: "\uFEFF\n**Veredito:** APROVADO\n" } }, {}, "ALLOW"],
  ["veredito na 2ª linha, texto antes",   { t: { runlog: DONE, brief: NSENS, reviewer: "# Review\n**Veredito:** APROVADO\n" } }, {}, "BLOCK"],
  ["_TEMPLATE é ignorado",                { _TEMPLATE: { runlog: DONE } }, {}, "ALLOW"],
  ["anti-loop (stop_hook_active)",        { t: { runlog: DONE, brief: NSENS } }, { stop_hook_active: true }, "ALLOW"],
];

let pass = 0, fail = 0;
const failures = [];

for (const [desc, tasks, stdin, want] of CASES) {
  const root = mkdtempSync(join(tmpdir(), "gate-"));
  try {
    if (tasks) {
      for (const [name, f] of Object.entries(tasks)) {
        const dir = join(root, "tasks", name);
        mkdirSync(join(dir, "artifacts"), { recursive: true });
        if (f.runlog) writeFileSync(join(dir, "run-log.md"), "| ts | agent | event | status | ref |\n" + f.runlog);
        if (f.brief) writeFileSync(join(dir, "brief.md"), "# Brief\n" + f.brief);
        if (f.reviewer) writeFileSync(join(dir, "artifacts", "reviewer.md"), f.reviewer);
        if (f.security) writeFileSync(join(dir, "artifacts", "security-sre.md"), f.security);
      }
    }
    const r = spawnSync("node", [HOOK], {
      input: JSON.stringify(stdin),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    const got = r.status === 2 ? "BLOCK" : "ALLOW";
    if (got === want) pass++;
    else { fail++; failures.push(`  [${want} esperado, veio ${got}]  ${desc}`); }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(HOOK);
console.log(`  passou: ${pass}/${CASES.length}   falhou: ${fail}`);
if (failures.length) console.log(failures.join("\n"));
