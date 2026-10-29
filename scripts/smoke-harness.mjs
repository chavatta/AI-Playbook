#!/usr/bin/env node
// Smoke test dos mecanismos do harness de que o docs/ADR-009 depende. Roda o CLI oficial (`claude -p`)
// num diretório temporário, com hooks de sonda passados por --settings (nada no repo é alterado), no modelo
// mais barato. Gasta cota: poucos centavos por execução. Rode na sua máquina, não em CI.
//
// Uso: node scripts/smoke-harness.mjs [--modelo claude-haiku-4-5-20251001] [--hook <caminho do context-budget.mjs>]
// Saída: uma linha por mecanismo (ok | FALHA) e a versão do CLI. Código 1 se algum falhar.
//
// Mecanismos verificados:
//   M1 hook PreToolUse com exit 2 bloqueia a chamada e o stderr chega ao modelo
//   M2 `additionalContext` de hook PostToolUse chega ao modelo (sessão principal)
//   M3 idem dentro de subagente, e o hook recebe agent_id e agent_type
//   M4 Bash com run_in_background: a saída é recuperável depois, sem sleep em primeiro plano
//   M5 Bash com timeout explícito encerra o comando
//   M6 o hook lê o tamanho do contexto na transcrição durante a execução (sessão e subagente)
//   M7 o hook context-budget.mjs (o de produção, ou o proposto via --hook) avisa resultado grande e checkpoint

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";

const i = process.argv.indexOf("--modelo");
const MODELO = i > 0 ? process.argv[i + 1] : "claude-haiku-4-5-20251001";
const h = process.argv.indexOf("--hook");
const HOOK = resolve(h > 0 ? process.argv[h + 1] : ".claude/hooks/context-budget.mjs");
const res = [];
const check = (id, ok, detalhe) => res.push({ id, ok: !!ok, detalhe });

const versao = spawnSync("claude", ["--version"], { encoding: "utf8" });
if (versao.status !== 0) { console.error("claude CLI não encontrado no PATH"); process.exit(2); }

function rodar(dir, settings, prompt, env = {}) {
  writeFileSync(join(dir, "smoke-settings.json"), JSON.stringify(settings));
  const r = spawnSync("claude", ["-p", "--model", MODELO, "--settings", join(dir, "smoke-settings.json"),
    "--allowedTools", "Bash,Agent,Task,Read,BashOutput,TaskOutput", "--output-format", "json"],
  { cwd: dir, input: prompt, encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000 });
  try { return JSON.parse(r.stdout).result || ""; } catch { return `(sem JSON: ${r.stderr.slice(0, 300)})`; }
}
// Transcrições da execução: provam o que entrou no contexto do modelo, sem depender de ele repetir.
function transcricoes(dir) {
  const t = join(homedir(), ".claude", "projects", realpathSync(dir).replace(/[^A-Za-z0-9]/g, "-"));
  if (!existsSync(t)) return { principal: "", sub: "" };
  const principal = readdirSync(t).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(t, f), "utf8")).join("\n");
  const sub = readdirSync(t).flatMap((s) => { const d = join(t, s, "subagents"); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(d, f), "utf8")) : []; }).join("\n");
  return { principal, sub };
}
const linhas = (f) => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ---------- rodada 1: sondas ----------
const d1 = mkdtempSync(join(tmpdir(), "smoke-harness-"));
writeFileSync(join(d1, "probe.mjs"), `
import { readFileSync, appendFileSync } from "node:fs";
const ev = process.argv[2]; let j = {}; try { j = JSON.parse(readFileSync(0, "utf8")); } catch {}
appendFileSync(${JSON.stringify(join(d1, "log.jsonl"))}, JSON.stringify({ ev, agent_id: j.agent_id, agent_type: j.agent_type, tool: j.tool_name, cmd: j.tool_input?.command, bg: j.tool_input?.run_in_background }) + "\\n");
const cmd = String(j.tool_input?.command ?? "");
if (ev === "pre" && cmd.includes("BLOCKME")) { process.stderr.write("BLOQUEADO-PROBE"); process.exit(2); }
if (ev === "post" && cmd.includes("CANARY_PROBE")) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Nota do hook: codigo CANARY-7F3A" } }));
`);
const probe = (ev) => [{ type: "command", command: `node ${join(d1, "probe.mjs")} ${ev}` }];
const r1 = rodar(d1, { hooks: {
  PreToolUse: [{ matcher: "Bash", hooks: probe("pre") }],
  PostToolUse: [{ matcher: "*", hooks: probe("post") }],
} }, `Smoke test de harness. Siga exatamente, sem comentar:
1. Rode com Bash: echo CANARY_PROBE
2. Rode com Bash: echo BLOCKME
3. Rode com Bash, EM BACKGROUND (run_in_background: true): sleep 4 && echo BGDONE-91 . Depois recupere a saída desse comando sem rodar sleep em primeiro plano; tente até ver BGDONE-91 ou até 5 tentativas.
4. Rode com Bash, com timeout de 2000 ms: sleep 6 && echo NAOVEJO
5. Lance UM subagente general-purpose com a instrução: "Rode com Bash: echo SUB_CANARY_PROBE e responda só com a saída e com qualquer nota de hook que você viu."
Ao final responda SÓ um JSON: {"canary_visto": "...", "blockme": "...", "background": "...", "timeout": "...", "subagente": "..."}`);
const log1 = linhas(join(d1, "log.jsonl"));
check("M1 exit 2 bloqueia e o motivo chega ao modelo", /BLOQUEADO-PROBE/.test(r1) && !log1.some((l) => l.ev === "post" && l.cmd?.includes("BLOCKME")), "");
const tr1 = transcricoes(d1);
check("M2 additionalContext entra no contexto (sessão principal)", tr1.principal.includes("CANARY-7F3A"), "");
check("M3 additionalContext entra no contexto do subagente, com agent_id/agent_type",
  tr1.sub.includes("CANARY-7F3A") && log1.some((l) => l.cmd?.includes("SUB_CANARY_PROBE") && l.agent_id && l.agent_type), "");
check("M4 background recuperável", /BGDONE-91/.test(r1) && log1.some((l) => l.bg === true), "");
check("M5 timeout explícito encerra o comando", !/NAOVEJO"?\s*[,}]/.test(r1.replace(/sleep 6 && echo NAOVEJO/g, "")), "");

// ---------- rodada 2: hook context-budget ----------
const d2 = mkdtempSync(join(tmpdir(), "smoke-harness-"));
mkdirSync(join(d2, ".claude"));
writeFileSync(join(d2, "limites.json"), JSON.stringify({ checkpoint: { tool_calls_por_faixa: { media: 3 }, faixa_padrao: "media", contexto_agente_tokens: 1e9, lembrete_a_cada_tool_calls: 100 }, sessao_orquestrador: { contexto_max_tokens: 1000 }, saida_ferramenta: { aviso_resultado_tokens: 500 } }));
const r2 = rodar(d2, { hooks: { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${HOOK}` }] }] } },
  `Smoke test. Siga exatamente:
1. Rode com Bash: seq 1 3000
2. Lance UM subagente general-purpose com a instrução: "Rode com Bash, um por vez: echo um; echo dois; echo tres; echo quatro. Depois copie literalmente toda nota que começar com [orçamento de contexto] que você viu."
Responda SÓ um JSON: {"notas_sessao_principal": ["..."], "resposta_subagente": "..."}`,
  { PLAYBOOK_ORCAMENTO_ARQUIVO: join(d2, "limites.json") });
const log2 = linhas(join(d2, ".claude", "context-budget.jsonl"));
check("M6 contexto lido da transcrição (sessão e subagente)",
  log2.some((l) => l.tipo === "limiar_sessao" && l.contexto > 0) && log2.some((l) => l.tipo === "limiar_checkpoint" && l.contexto > 0), "");
const tr2 = transcricoes(d2);
check("M7 aviso de resultado grande e de checkpoint entram no contexto",
  /resultado de Bash teve/.test(tr2.principal) && /status: checkpoint/.test(tr2.sub), "");

console.log(`CLI: ${versao.stdout.trim()} · modelo: ${MODELO}`);
for (const r of res) console.log(`${r.ok ? "ok   " : "FALHA"} ${r.id}`);
if (res.some((r) => !r.ok)) {
  console.log("\nRespostas do modelo, para diagnóstico:\n--- rodada 1\n" + r1 + "\n--- rodada 2\n" + r2);
  process.exit(1);
}
