#!/usr/bin/env node
// Suíte do hook context-budget.mjs (docs/ADR-009). Sem dependência, sem rede, sem modelo.
// Uso: node docs/patches/test-context-budget.mjs <caminho-do-hook>
// Cada caso monta um projeto falso num diretório temporário (perfil, brief, transcrições) e roda o hook
// como o runtime roda: JSON no stdin, lendo stdout e o código de saída.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const hook = resolve(process.argv[2] || ".claude/hooks/context-budget.mjs");
let ok = 0, falhas = 0;
const caso = (nome, fn) => {
  try { fn(); ok++; console.log(`ok   ${nome}`); } catch (e) { falhas++; console.log(`FALHA ${nome}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const perfil = (obj) => `# 00\n\n## Orçamento de contexto e execução\n\n<!-- orcamento-contexto:inicio -->\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n<!-- orcamento-contexto:fim -->\n`;
const usage = (ctx) => JSON.stringify({ type: "assistant", message: { id: "m", usage: { input_tokens: 2, cache_read_input_tokens: ctx - 102, cache_creation_input_tokens: 100, output_tokens: 50 } } });

function projeto({ limites, complexidade, primeiroPrompt = "Task x", ctxAgente, ctxSessao, workflow = false } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "cb-"));
  mkdirSync(join(raiz, ".claude"));
  mkdirSync(join(raiz, "praticas"));
  if (limites) writeFileSync(join(raiz, "praticas", "00-stack-e-defaults.md"), perfil(limites));
  const T = "2026-01-01_caso";
  mkdirSync(join(raiz, "tasks", T, "artifacts"), { recursive: true });
  if (complexidade) writeFileSync(join(raiz, "tasks", T, "brief.md"), `**Complexidade:** ${complexidade}\n`);
  const sessao = `s-${Math.random().toString(36).slice(2)}`;
  const tdir = join(raiz, "transcricoes");
  const sub = workflow ? join(tdir, sessao, "subagents", "workflows", "wf_abc-123") : join(tdir, sessao, "subagents");
  mkdirSync(sub, { recursive: true });
  const tp = join(tdir, `${sessao}.jsonl`);
  writeFileSync(tp, [JSON.stringify({ type: "user", message: { content: "oi" } }), ctxSessao ? usage(ctxSessao) : ""].join("\n"));
  writeFileSync(join(sub, "agent-a1.jsonl"),
    [JSON.stringify({ type: "user", message: { content: primeiroPrompt.replace("{T}", T) } }), ctxAgente ? usage(ctxAgente) : ""].join("\n"));
  return { raiz, sessao, tp, T };
}

function roda(p, extra = {}, env = {}) {
  const entrada = { session_id: p.sessao, transcript_path: p.tp, cwd: p.raiz, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "echo" }, tool_response: { stdout: "ok" }, ...extra };
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(entrada), encoding: "utf8", env: { ...process.env, PLAYBOOK_ORCAMENTO_ARQUIVO: "", ...env } });
  let ctx = "";
  if (r.stdout.trim()) ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  return { code: r.status, stderr: r.stderr, ctx };
}

const LIM = { checkpoint: { tool_calls_por_faixa: { trivial: 2, simples: 2, media: 3, complexa: 5 }, faixa_padrao: "media", contexto_agente_tokens: 1000, lembrete_a_cada_tool_calls: 2 }, sessao_orquestrador: { contexto_max_tokens: 5000 }, saida_ferramenta: { aviso_resultado_tokens: 100 } };

caso("stdin inválido: sai 0 sem saída", () => {
  const r = spawnSync(process.execPath, [hook], { input: "não é json", encoding: "utf8" });
  assert(r.status === 0 && r.stdout === "" && r.stderr === "", `code=${r.status} out=${r.stdout} err=${r.stderr}`);
});

caso("resultado pequeno: nenhum aviso", () => {
  const p = projeto({ limites: LIM });
  const r = roda(p);
  assert(r.code === 0 && r.ctx === "", r.ctx);
});

caso("resultado grande: avisa, cita praticas/12 e registra", () => {
  const p = projeto({ limites: LIM });
  const r = roda(p, { tool_response: { stdout: "x".repeat(2000) } });
  assert(r.code === 0 && r.stderr === "", "não pode bloquear nem escrever em stderr");
  assert(/~50[0-9] tokens \(limite 100\)/.test(r.ctx) && r.ctx.includes("praticas/12"), r.ctx);
  const log = readFileSync(join(p.raiz, ".claude", "context-budget.jsonl"), "utf8");
  assert(log.includes('"resultado_grande"'), log);
});

caso("Write/Edit: conteúdo e patch no tool_response não contam (o modelo só vê a confirmação)", () => {
  const p = projeto({ limites: LIM });
  for (const t of ["Write", "Edit", "MultiEdit"]) {
    const r = roda(p, { tool_name: t, tool_response: { type: "create", content: "x".repeat(20000), structuredPatch: [{ lines: ["+" + "y".repeat(20000)] }], originalFile: "z".repeat(20000) } });
    assert(r.ctx === "", `${t}: ${r.ctx}`);
  }
});

caso("Bash: só stdout e stderr contam, não o bashEditDiff", () => {
  const p = projeto({ limites: LIM });
  assert(roda(p, { tool_response: { stdout: "ok", stderr: "", interrupted: false, bashEditDiff: "d".repeat(40000) } }).ctx === "", "diff invisível não avisa");
  assert(roda(p, { tool_response: { stdout: "x".repeat(300), stderr: "e".repeat(300), bashEditDiff: "" } }).ctx.includes("~150 tokens"), "stdout + stderr somam");
});

caso("Read: mede o conteúdo do arquivo", () => {
  const p = projeto({ limites: LIM });
  const r = roda(p, { tool_name: "Read", tool_response: { type: "text", file: { filePath: "a.ts", content: "l".repeat(2000), numLines: 50 } } });
  assert(/O resultado de Read teve ~500 tokens/.test(r.ctx), r.ctx);
});

caso("sem perfil: usa defaults (8000 tokens)", () => {
  const p = projeto({});
  assert(roda(p, { tool_response: { stdout: "x".repeat(2000) } }).ctx === "", "2000 bytes não passam do default");
  assert(roda(p, { tool_response: { stdout: "x".repeat(40000) } }).ctx.includes("limite 8000"), "40000 bytes passam");
});

caso("sem .claude/: avisa mas não cria registro", () => {
  const p = projeto({ limites: LIM });
  rmSync(join(p.raiz, ".claude"), { recursive: true });
  const r = roda(p, { tool_response: { stdout: "x".repeat(2000) } });
  assert(r.ctx !== "" && !existsSync(join(p.raiz, ".claude")), "não deve criar .claude/");
});

caso("subagente: checkpoint no limiar da faixa do brief (simples = 2)", () => {
  const p = projeto({ limites: LIM, complexidade: "simples", primeiroPrompt: "Leia tasks/{T}/brief.md" });
  const extra = { agent_id: "a1", agent_type: "coder-opus" };
  assert(roda(p, extra).ctx === "", "1ª chamada não avisa");
  const r = roda(p, extra);
  assert(/2 tool calls \(limite 2 na faixa simples\)/.test(r.ctx) && r.ctx.includes("status: checkpoint"), r.ctx);
});

caso("subagente: faixa com acento no brief (média = 3)", () => {
  const p = projeto({ limites: LIM, complexidade: "média", primeiroPrompt: "tasks/{T}/brief.md" });
  const extra = { agent_id: "a1", agent_type: "tester-opus" };
  roda(p, extra); roda(p, extra);
  assert(roda(p, extra).ctx.includes("faixa media"), "3ª chamada avisa na faixa media");
});

caso("subagente: recon prevalece sobre o brief", () => {
  const p = projeto({ limites: LIM, complexidade: "simples", primeiroPrompt: "tasks/{T}/brief.md" });
  writeFileSync(join(p.raiz, "tasks", p.T, "artifacts", "recon.md"), "- Complexidade: complexa\n");
  const extra = { agent_id: "a1", agent_type: "coder-opus" };
  for (let i = 0; i < 4; i++) assert(roda(p, extra).ctx === "", `chamada ${i + 1} não avisa (complexa = 5)`);
  assert(roda(p, extra).ctx.includes("faixa complexa"), "5ª avisa");
});

caso("subagente sem task: faixa padrão", () => {
  const p = projeto({ limites: LIM });
  const extra = { agent_id: "a1", agent_type: "coder-opus" };
  roda(p, extra); roda(p, extra);
  assert(roda(p, extra).ctx.includes("faixa media"), "padrão media = 3");
});

caso("subagente: lembrete só a cada N chamadas depois do limiar", () => {
  const p = projeto({ limites: LIM });
  const extra = { agent_id: "a1", agent_type: "coder-opus" };
  roda(p, extra); roda(p, extra);
  assert(roda(p, extra).ctx !== "", "3ª avisa");
  assert(roda(p, extra).ctx === "", "4ª não repete");
  assert(roda(p, extra).ctx !== "", "5ª lembra (a cada 2)");
});

caso("subagente: checkpoint por contexto lido da transcrição, uma vez", () => {
  const p = projeto({ limites: LIM, ctxAgente: 4000 });
  const extra = { agent_id: "a1", agent_type: "debugger-opus" };
  const r = roda(p, extra);
  assert(/contexto em ~4000 tokens \(limite 1000\)/.test(r.ctx), r.ctx);
  assert(roda(p, extra).ctx === "", "não repete o aviso de contexto");
});

caso("reviewer e security-sre: escopo excedido, nunca checkpoint", () => {
  for (const t of ["reviewer-opus", "security-sre-fable", "reviewer"]) {
    const p = projeto({ limites: LIM, ctxAgente: 4000 });
    const r = roda(p, { agent_id: "a1", agent_type: t });
    assert(r.ctx.includes("escopo excedido") && !r.ctx.includes("status: checkpoint"), `${t}: ${r.ctx}`);
  }
});

caso("sessão principal: aviso de handoff acima do limiar", () => {
  const p = projeto({ limites: LIM, ctxSessao: 9000 });
  const r = roda(p);
  assert(/~9000 tokens de contexto \(limite 5000\)/.test(r.ctx) && r.ctx.includes("handoff/sessao-NN.md"), r.ctx);
  assert(roda(p).ctx === "", "não repete na chamada seguinte");
});

caso("sessão principal abaixo do limiar: nada", () => {
  const p = projeto({ limites: LIM, ctxSessao: 3000 });
  assert(roda(p).ctx === "", "3000 < 5000");
});

caso("contagem separada por agente e por sessão", () => {
  const p = projeto({ limites: LIM });
  roda(p, { agent_id: "a1", agent_type: "coder-opus" });
  roda(p, { agent_id: "a1", agent_type: "coder-opus" });
  assert(roda(p, { agent_id: "a2", agent_type: "coder-opus" }).ctx === "", "a2 começa do zero");
});

caso("perfil com JSON inválido: defaults, sem erro", () => {
  const p = projeto({});
  writeFileSync(join(p.raiz, "praticas", "00-stack-e-defaults.md"), "<!-- orcamento-contexto:inicio -->\n```json\n{quebrado\n```\n<!-- orcamento-contexto:fim -->\n");
  const r = roda(p, { tool_response: { stdout: "x".repeat(40000) } });
  assert(r.code === 0 && r.ctx.includes("limite 8000"), r.ctx);
});

caso("agente de Workflow (subagents/workflows/{run}/): lê contexto e faixa da transcrição", () => {
  const p = projeto({ limites: LIM, ctxAgente: 4000, workflow: true });
  const r = roda(p, { agent_id: "a1", agent_type: "coder-sonnet" });
  assert(/contexto em ~4000 tokens \(limite 1000\)/.test(r.ctx), r.ctx);
  const q = projeto({ limites: LIM, complexidade: "complexa", primeiroPrompt: "Leia tasks/{T}/brief.md", workflow: true });
  for (let i = 0; i < 4; i++) assert(roda(q, { agent_id: "a1", agent_type: "coder-sonnet" }).ctx === "", `chamada ${i + 1} abaixo do teto 5 da faixa complexa`);
  assert(/faixa complexa/.test(roda(q, { agent_id: "a1", agent_type: "coder-sonnet" }).ctx), "5ª chamada: teto da faixa complexa, não da padrão");
});

caso("o bloco do perfil real do playbook é JSON válido e tem todas as chaves do hook", async () => {
  const t = readFileSync(resolve("praticas/00-stack-e-defaults.md"), "utf8");
  const m = /<!--\s*orcamento-contexto:inicio\s*-->[\s\S]*?```json\s*([\s\S]*?)```/.exec(t);
  assert(m, "bloco ausente em praticas/00");
  const o = JSON.parse(m[1]);
  for (const k of ["trivial", "simples", "media", "complexa"]) assert(Number.isFinite(o.checkpoint.tool_calls_por_faixa[k]), `faixa ${k}`);
  assert(Number.isFinite(o.checkpoint.contexto_agente_tokens) && Number.isFinite(o.sessao_orquestrador.contexto_max_tokens) && Number.isFinite(o.saida_ferramenta.aviso_resultado_tokens), "limiares numéricos");
});

console.log(`\n${ok}/${ok + falhas}`);
process.exit(falhas ? 1 : 0);
