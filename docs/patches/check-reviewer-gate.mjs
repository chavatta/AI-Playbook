#!/usr/bin/env node
// Stop — quality gate do Reviewer + gate de segurança (Security-SRE) + revisão humana e dado pessoal autorizado (ADR-011).
// Antes de encerrar a sessão, verifica se alguma task foi marcada como `done`
// no run-log sem veredito APROVADO ancorado em artifacts/reviewer.md — e, em
// task sensível, também em artifacts/security-sre.md. Quando o brief exige
// revisão humana ou declara dado pessoal autorizado, exige artifacts/revisao-humana.md
// APROVADO e assinado; com dado pessoal, também o registro da autorização válido na data do done.
// Multiplataforma — mesma lógica do check-reviewer-gate.sh (legado), mais o ADR-011.
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
// Admite BOM e linhas em branco antes do veredito; nada além disso. O lookahead recusa o
// modelo não preenchido ("APROVADO | REPROVADO").
const VEREDITO_APROVADO = /^﻿?\s*\*\*Veredito:\*\*\s*APROVADO\b(?!\s*\|)/;
// Revisão humana assinada: linha "**Revisor:** <nome> · <data>", nunca o placeholder "{nome}".
const REVISOR = /^\*\*Revisor:\*\*[ \t]*(?![{\s])\S/m;
// Campos do brief (ADR-011). O lookahead evita falso positivo no template ("obrigatória | dispensada").
const HUMANA_OBRIGATORIA = /Revis[aã]o humana:\*{0,2}\s*obrigat[oó]ria(?![\p{L}])(?!\s*\|)/iu;
const DADOS_AUTORIZADOS = /Dados pessoais:\*{0,2}\s*autorizados(?![\p{L}])(?!\s*\|)/iu;
const DADOS_REGISTRO = /Dados pessoais:\*{0,2}\s*autorizados[^\n]*?`?(docs\/autorizacoes\/[^\s`|)]+\.md)/iu;
const VALIDADE = /\*\*Validade:\*\*\s*(\d{4}-\d{2}-\d{2})/;

const ler = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const bloquear = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(2);
};

let entries = [];
try {
  entries = readdirSync(tasksDir, { withFileTypes: true });
} catch {
  process.exit(0);
}

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name === "_TEMPLATE") continue;
  const dir = join(tasksDir, entry.name);
  const log = join(dir, "run-log.md");
  if (!existsSync(log)) continue;

  let logText = "";
  try {
    logText = readFileSync(log, "utf8");
  } catch {
    continue;
  }

  // task marcada como done no run-log (coluna event ou status)
  if (!/\|\s*done\s*\|/i.test(logText)) continue;

  const approved = VEREDITO_APROVADO.test(ler(join(dir, "artifacts", "reviewer.md")));
  if (!approved) {
    bloquear(
      `GATE VIOLADO: a task '${entry.name}' está marcada como done sem '**Veredito:** APROVADO' na primeira linha de artifacts/reviewer.md. Rode o reviewer (ou corrija o run-log) antes de encerrar — GOVERNANCE.md §3.`
    );
  }

  const briefText = ler(join(dir, "brief.md"));
  const dadosPessoais = DADOS_AUTORIZADOS.test(briefText);

  // Gate de segurança: brief marcou a task como sensível (ou declarou dado pessoal autorizado,
  // que a torna sensível — ADR-011 D2.5) → exige security-sre.md aprovado.
  // O lookahead evita falso positivo no template não preenchido ("sim | não").
  const isSensitive = dadosPessoais || /Sens[ií]vel \(security gate\):\*{0,2}\s*sim\b(?!\s*\|)/i.test(briefText);
  if (isSensitive && !VEREDITO_APROVADO.test(ler(join(dir, "artifacts", "security-sre.md")))) {
    bloquear(
      `GATE VIOLADO: a task sensível '${entry.name}' está done sem '**Veredito:** APROVADO' na primeira linha de artifacts/security-sre.md — GOVERNANCE.md §3.5.`
    );
  }

  // Revisão humana (ADR-011 D1): obrigatória pelo brief, ou sempre que há dado pessoal autorizado.
  if (dadosPessoais || HUMANA_OBRIGATORIA.test(briefText)) {
    const rh = ler(join(dir, "artifacts", "revisao-humana.md"));
    if (!VEREDITO_APROVADO.test(rh) || !REVISOR.test(rh)) {
      bloquear(
        `GATE VIOLADO: a task '${entry.name}' exige revisão humana e está done sem artifacts/revisao-humana.md com '**Veredito:** APROVADO' na primeira linha e a linha '**Revisor:**' preenchida. Rode /task aprovar ${entry.name} — docs/ADR-011.`
      );
    }
  }

  // Dado pessoal autorizado (ADR-011 D2.8): o registro citado no brief existe e a validade cobre a data do done.
  // Compara com a data do done, não com hoje: autorização vencida depois não reabre task antiga.
  if (dadosPessoais) {
    const ref = DADOS_REGISTRO.exec(briefText)?.[1];
    if (!ref || ref.split("/").includes("..")) {
      bloquear(
        `GATE VIOLADO: a task '${entry.name}' declara dado pessoal autorizado sem caminho válido para o registro em docs/autorizacoes/ no brief.md — docs/ADR-011.`
      );
    }
    const registro = ler(join(root, ref));
    const validade = VALIDADE.exec(registro)?.[1];
    const doneLinha = logText.split(/\r?\n/).find((l) => /\|\s*done\s*\|/i.test(l)) || "";
    const doneData = /(\d{4}-\d{2}-\d{2})/.exec(doneLinha)?.[1];
    if (!registro || !validade || !doneData || validade < doneData) {
      bloquear(
        `GATE VIOLADO: a task '${entry.name}' usou dado pessoal e o registro '${ref}' ${!registro ? "não existe" : !validade ? "não tem **Validade:** AAAA-MM-DD" : !doneData ? "não pôde ser comparado: a linha de done do run-log não tem data" : `venceu em ${validade}, antes do done (${doneData})`} — docs/ADR-011.`
      );
    }
  }
}

process.exit(0);
