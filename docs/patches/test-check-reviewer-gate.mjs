#!/usr/bin/env node
// Banco de casos para check-reviewer-gate.mjs.
// Uso: node test-check-reviewer-gate.mjs <caminho-do-hook>
// Cada caso monta um tasks/ temporário e roda o hook com CLAUDE_PROJECT_DIR apontando para ele.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOOK = resolve(process.argv[2]);

const DONE = "| 2026-09-23 10:00 | orchestrator | done | approved | - |\n";
const OPEN = "| 2026-09-23 10:00 | orchestrator | task_created | - | brief.md |\n";
const OK = "**Veredito:** APROVADO\n\n# Review\n";
const NOK = "**Veredito:** REPROVADO (2 issues)\n\n# Review\n";
const NOK_CITA = "**Veredito:** REPROVADO (1 issue)\n\nNa rodada anterior o artifact dizia:\n\n**Veredito:** APROVADO\n";
const SENS = "**Sensível (security gate):** sim — toca auth\n";
const NSENS = "**Sensível (security gate):** não\n";
const TEMPLATE = "**Sensível (security gate):** sim | não — toca auth…\n";

// ADR-011: revisão humana e dado pessoal autorizado (DONE é de 2026-09-23)
const HUMANA = NSENS + "**Revisão humana:** obrigatória\n";
const HUMANA_TPL = NSENS + "**Revisão humana:** obrigatória | dispensada — vem do perfil\n";
const DISPENSADA = NSENS + "**Revisão humana:** dispensada\n";
const RH_OK = "**Veredito:** APROVADO\n**Revisor:** Fulano · 2026-09-23\n";
const RH_SEM_REVISOR = "**Veredito:** APROVADO\n**Revisor:** {nome} · AAAA-MM-DD\n";
const RH_MODELO = "**Veredito:** APROVADO | REPROVADO (n pontos)\n**Revisor:** {nome} · AAAA-MM-DD\n";
const RH_NOK = "**Veredito:** REPROVADO (1 ponto)\n**Revisor:** Fulano · 2026-09-23\n";
const REG = "docs/autorizacoes/acme-2026-09-01.md";
const DADOS = SENS + `**Dados pessoais:** autorizados — ${REG}\n**Revisão humana:** obrigatória\n`;
const DADOS_SEM_SENS = NSENS + `**Dados pessoais:** autorizados — ${REG}\n**Revisão humana:** dispensada\n`;
const DADOS_SEM_REF = SENS + "**Dados pessoais:** autorizados\n";
const DADOS_TPL = NSENS + "**Dados pessoais:** não | autorizados — docs/autorizacoes/<arquivo>.md\n";
const DADOS_FUGA = SENS + "**Dados pessoais:** autorizados — docs/autorizacoes/../../x.md\n";
const VIGENTE = { [REG]: "**Status:** vigente\n**Validade:** 2026-12-31\n" };
const VENCIDA = { [REG]: "**Status:** vigente\n**Validade:** 2026-09-01\n" };
const NO_DIA = { [REG]: "**Status:** vigente\n**Validade:** 2026-09-23\n" };
const SEM_VALIDADE = { [REG]: "**Status:** vigente\n" };

// [descricao, { task: { runlog, brief, reviewer, security, humana }, ...arquivos da raiz } | null, stdin, esperado]
// Chave com "/" é arquivo relativo à raiz do projeto (ex.: o registro da autorização).
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

  // ---------- ADR-011 D1: revisão humana ----------
  ["humana obrigatória, sem registro",    { t: { runlog: DONE, brief: HUMANA, reviewer: OK } }, {}, "BLOCK"],
  ["humana obrigatória, APROVADO assinado",{ t: { runlog: DONE, brief: HUMANA, reviewer: OK, humana: RH_OK } }, {}, "ALLOW"],
  ["humana obrigatória, REPROVADO",       { t: { runlog: DONE, brief: HUMANA, reviewer: OK, humana: RH_NOK } }, {}, "BLOCK"],
  ["humana obrigatória, revisor placeholder",{ t: { runlog: DONE, brief: HUMANA, reviewer: OK, humana: RH_SEM_REVISOR } }, {}, "BLOCK"],
  ["humana obrigatória, modelo copiado",  { t: { runlog: DONE, brief: HUMANA, reviewer: OK, humana: RH_MODELO } }, {}, "BLOCK"],
  ["humana dispensada, sem registro",     { t: { runlog: DONE, brief: DISPENSADA, reviewer: OK } }, {}, "ALLOW"],
  ["humana de template (obrigatória | …)",{ t: { runlog: DONE, brief: HUMANA_TPL, reviewer: OK } }, {}, "ALLOW"],
  ["humana obrigatória, task aberta",     { t: { runlog: OPEN, brief: HUMANA, reviewer: OK } }, {}, "ALLOW"],
  ["humana obrigatória, reviewer REPROVADO",{ t: { runlog: DONE, brief: HUMANA, reviewer: NOK, humana: RH_OK } }, {}, "BLOCK"],

  // ---------- ADR-011 D2: dado pessoal autorizado ----------
  ["dados: tudo certo, registro vigente", { t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK, humana: RH_OK }, ...VIGENTE }, {}, "ALLOW"],
  ["dados: validade no próprio dia do done",{ t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK, humana: RH_OK }, ...NO_DIA }, {}, "ALLOW"],
  ["dados: registro vencido antes do done",{ t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK, humana: RH_OK }, ...VENCIDA }, {}, "BLOCK"],
  ["dados: registro ausente",             { t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK, humana: RH_OK } }, {}, "BLOCK"],
  ["dados: registro sem Validade",        { t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK, humana: RH_OK }, ...SEM_VALIDADE }, {}, "BLOCK"],
  ["dados: brief sem caminho do registro",{ t: { runlog: DONE, brief: DADOS_SEM_REF, reviewer: OK, security: OK, humana: RH_OK }, ...VIGENTE }, {}, "BLOCK"],
  ["dados: caminho com ..",               { t: { runlog: DONE, brief: DADOS_FUGA, reviewer: OK, security: OK, humana: RH_OK }, ...VIGENTE }, {}, "BLOCK"],
  ["dados: sem revisão humana",           { t: { runlog: DONE, brief: DADOS, reviewer: OK, security: OK }, ...VIGENTE }, {}, "BLOCK"],
  ["dados: 'dispensada' não dispensa",    { t: { runlog: DONE, brief: DADOS_SEM_SENS, reviewer: OK, security: OK }, ...VIGENTE }, {}, "BLOCK"],
  ["dados: 'Sensível: não' exige security",{ t: { runlog: DONE, brief: DADOS_SEM_SENS, reviewer: OK, humana: RH_OK }, ...VIGENTE }, {}, "BLOCK"],
  ["dados: brief de template",            { t: { runlog: DONE, brief: DADOS_TPL, reviewer: OK } }, {}, "ALLOW"],
  ["dados: done sem data no run-log",     { t: { runlog: "| ontem | orchestr. | done | done | - |\n", brief: DADOS, reviewer: OK, security: OK, humana: RH_OK }, ...VIGENTE }, {}, "BLOCK"],
];

let pass = 0, fail = 0;
const failures = [];

for (const [desc, tasks, stdin, want] of CASES) {
  const root = mkdtempSync(join(tmpdir(), "gate-"));
  try {
    if (tasks) {
      for (const [name, f] of Object.entries(tasks)) {
        if (name.includes("/")) {
          mkdirSync(dirname(join(root, name)), { recursive: true });
          writeFileSync(join(root, name), f);
          continue;
        }
        const dir = join(root, "tasks", name);
        mkdirSync(join(dir, "artifacts"), { recursive: true });
        if (f.runlog) writeFileSync(join(dir, "run-log.md"), "| ts | agent | event | status | ref |\n" + f.runlog);
        if (f.brief) writeFileSync(join(dir, "brief.md"), "# Brief\n" + f.brief);
        if (f.reviewer) writeFileSync(join(dir, "artifacts", "reviewer.md"), f.reviewer);
        if (f.security) writeFileSync(join(dir, "artifacts", "security-sre.md"), f.security);
        if (f.humana) writeFileSync(join(dir, "artifacts", "revisao-humana.md"), f.humana);
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
