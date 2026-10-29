#!/usr/bin/env node
// Stop — quality gate do Reviewer + gate de segurança (Security-SRE).
// Antes de encerrar a sessão, verifica se alguma task foi marcada como `done`
// no run-log sem veredito APROVADO ancorado em artifacts/reviewer.md — e, em
// task sensível, também em artifacts/security-sre.md.
// Multiplataforma — mesma lógica do check-reviewer-gate.sh (legado).
// exit 2 = impede o encerramento e devolve a pendência ao agente.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // segue com defaults
}

// anti-loop: se a sessão já está continuando por causa deste hook, não bloquear de novo
if (input?.stop_hook_active === true) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || ".";
const tasksDir = join(root, "tasks");
if (!existsSync(tasksDir)) process.exit(0);

// Veredito ancorado na PRIMEIRA LINHA do artifact (GOVERNANCE.md §3.4), formato exato
// definido nos manuais. Sem a flag `m`: com ela, `^` casava início de QUALQUER linha, e um
// artifact que abre com "REPROVADO" mas cita um "**Veredito:** APROVADO" anterior passava.
// Admite BOM e linhas em branco antes do veredito; nada além disso.
const VEREDITO_APROVADO = /^\uFEFF?\s*\*\*Veredito:\*\*\s*APROVADO\b/;

let entries = [];
try {
  entries = readdirSync(tasksDir, { withFileTypes: true });
} catch {
  process.exit(0);
}

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name === "_TEMPLATE") continue;
  const log = join(tasksDir, entry.name, "run-log.md");
  if (!existsSync(log)) continue;

  let logText = "";
  try {
    logText = readFileSync(log, "utf8");
  } catch {
    continue;
  }

  // task marcada como done no run-log (coluna event ou status)
  if (/\|\s*done\s*\|/i.test(logText)) {
    const rev = join(tasksDir, entry.name, "artifacts", "reviewer.md");
    const approved = existsSync(rev) && VEREDITO_APROVADO.test(readFileSync(rev, "utf8"));
    if (!approved) {
      process.stderr.write(
        `GATE VIOLADO: a task '${entry.name}' está marcada como done sem '**Veredito:** APROVADO' na primeira linha de artifacts/reviewer.md. Rode o reviewer (ou corrija o run-log) antes de encerrar — GOVERNANCE.md §3.\n`
      );
      process.exit(2);
    }

    // Gate de segurança: brief marcou a task como sensível → exige security-sre.md aprovado.
    // O lookahead evita falso positivo no template não preenchido ("sim | não").
    const brief = join(tasksDir, entry.name, "brief.md");
    const isSensitive =
      existsSync(brief) &&
      /Sens[ií]vel \(security gate\):\*{0,2}\s*sim\b(?!\s*\|)/i.test(readFileSync(brief, "utf8"));
    if (isSensitive) {
      const sec = join(tasksDir, entry.name, "artifacts", "security-sre.md");
      const secOk = existsSync(sec) && VEREDITO_APROVADO.test(readFileSync(sec, "utf8"));
      if (!secOk) {
        process.stderr.write(
          `GATE VIOLADO: a task sensível '${entry.name}' está done sem '**Veredito:** APROVADO' na primeira linha de artifacts/security-sre.md — GOVERNANCE.md §3.5.\n`
        );
        process.exit(2);
      }
    }
  }
}

process.exit(0);
