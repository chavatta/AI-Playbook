#!/usr/bin/env node
// Suíte do portal de gestão (gestao/serve.mjs, gestao/index.html). Sobe o servidor em porta livre contra projetos
// de fixture em diretório temporário (GESTAO_ROOT): sem rede externa, sem modelo, sem tocar no repo.
// Uso: node scripts/test-gestao.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import vm from "node:vm";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVE = resolve("gestao/serve.mjs");
const HTML = readFileSync(resolve("gestao/index.html"), "utf8");
const TEMPLATE = JSON.parse(readFileSync(resolve("gestao/projeto.template.json"), "utf8"));
const base = mkdtempSync(join(os.tmpdir(), "gestao-"));
const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

const grava = (raiz, rel, txt) => { const p = join(raiz, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof txt === "string" ? txt : JSON.stringify(txt)); };
const agora = Date.now();
const iso = (off = 0) => new Date(agora + off).toISOString();
let seq = 0;
const ev = (type, extra = {}) => JSON.stringify({ schema: "playbook.telemetry/v1", event_id: "E" + ++seq, ts: iso(seq * 10), source: { kind: "hook" }, type, ...extra });

function sobe(raiz, env = {}) {
  return new Promise((ok, falha) => {
    const p = spawn(process.execPath, [SERVE], { env: { ...process.env, GESTAO_ROOT: raiz, GESTAO_PORT: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; const m = out.match(/:(\d+)/); if (m) ok({ p, porta: Number(m[1]) }); });
    p.on("exit", (c) => falha(new Error("servidor saiu: " + c + " " + out)));
    setTimeout(() => falha(new Error("servidor não subiu")), 8000);
  });
}
const pega = (porta, path = "/api/state", opts = {}) => new Promise((ok, falha) => {
  const r = http.request({ host: "127.0.0.1", port: porta, path, method: opts.method || "GET", headers: opts.headers }, (res) => {
    let b = ""; res.on("data", (d) => b += d); res.on("end", () => ok({ status: res.statusCode, body: b, headers: res.headers }));
  });
  r.on("error", falha); r.end();
});
const estado = async (porta) => JSON.parse((await pega(porta)).body);
const afirma = (cond, msg) => { if (!cond) throw new Error(msg); };
const igual = (a, b, msg) => afirma(JSON.stringify(a) === JSON.stringify(b), `${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

// ---------- fixture completa ----------
const cheio = join(base, "cheio");
grava(cheio, "gestao/projeto.json", {
  nome: "Projeto X", atualizado: "2026-11-11",
  fases: [{ id: 0, nome: "Fundação", status: "andamento", itens: [{ t: "A <b>negrito</b>", s: "feito" }, { t: "B", s: "bloqueado", bloqueio_id: "B1" }] }],
  decisoes: [
    { id: "Q1", pergunta: "Sem resposta?", opcoes: ["a", "b"] },
    { id: "Q2", pergunta: "Com resposta?", opcoes: ["x", "y"], resposta: "y", por: "dev", data: "2026-11-11", registro: "docs/adr/0002-x.md" },
  ],
  bloqueios: [{ id: "B1", titulo: "Bloqueio <script>alert(1)</script>", desde: "2026-11-11", gravidade: "alta", bloqueia: "tudo", causa: "porque", resolver: ["passo 1", "passo 2"], pronto_quando: "quando", dono: "dev", arquivos: ["a.md"], depende_de: [] }],
  aprovacoes: [{ t: "ADRs", quem: "dev", data: "2026-11-11", ok: true }],
  pendencias_manuais: ["fazer à mão"],
});
grava(cheio, "docs/adr/0001-primeiro.md", "# ADR-0001: Primeiro\n\n**Status:** Aceito\n");
grava(cheio, "docs/adr/ACME-D07-segundo.md", "# ACME-D07: Segundo <img src=x>\r\n\r\n**Status:** Proposto — falta spike\r\n");
grava(cheio, "docs/ADR-010-terceiro.md", "# ADR-010 — Terceiro\n\n**Status:** Aprovado\n");
grava(cheio, "docs/ADR-010-nota-01-x.md", "# ADR-010, nota 01 — Nota\n\n**Status:** Proposto\n");
grava(cheio, "docs/README.md", "# nao e adr\n**Status:** x\n");
grava(cheio, ".claude/agents/planner.md", "---\nname: planner-sonnet\nmodel: sonnet\neffort: medium\n---\n# P\n");
grava(cheio, ".claude/agents/coder.md", "---\r\nname: coder-sonnet\r\nmodel: sonnet\r\neffort: high\r\n---\r\n# C\r\n");
grava(cheio, ".claude/agents/reviewer.md", "---\nname: reviewer-opus\nmodel: opus\neffort: xhigh\n---\n# R\n");
grava(cheio, ".claude/settings.local.json", { env: { PLAYBOOK_TELEMETRY_URL: "spool", PLAYBOOK_PROJECT_ID: "x" }, outra: 1 });
const LOG_HDR = "# Run Log\n\n| timestamp | agent | event | status | ref |\n|---|---|---|---|---|\n";
grava(cheio, "tasks/_TEMPLATE/brief.md", "# modelo");
grava(cheio, "tasks/2026-11-01_um/brief.md", "# Brief\n\n**Complexidade:** média\n**Sensível (security gate):** sim — toca auth\n\n## Objetivo (verificável)\nFazer o um.\n");
grava(cheio, "tasks/2026-11-01_um/run-log.md", LOG_HDR + "| 2026-11-01 10:00 | orchestr. | task_created | - | brief.md |\n| 2026-11-01 10:05 | planner-sonnet | completed | - | artifacts/planner.md |\n| 2026-11-01 10:20 | coder-sonnet | started | - | - |\n");
grava(cheio, "tasks/2026-11-02_dois/brief.md", "# Brief\n\n## Objetivo (verificável)\nFazer o dois.\n");
grava(cheio, "tasks/2026-11-02_dois/run-log.md", LOG_HDR + "| 2026-11-02 09:00 | coder-sonnet | blocked | blocked | decisions.md |\n");
grava(cheio, "tasks/2026-11-03_tres/run-log.md", LOG_HDR + "| 2026-11-03 09:00 | reviewer-opus | completed | - | x |\n| 2026-11-03 09:10 | orchestr. | done | - | - |\n");
grava(cheio, "tasks/2026-11-01_um/artifacts/planner.md", "x");
// Eventos sintéticos: `agent` é OBJETO no contrato v1.
const eventos = [
  ev("session.start", { run_id: "run_R1", task_id: "RT1", agent: { name: "main" }, data: { effort: "xhigh" } }),
  ev("subagent.start", { run_id: "run_R1", task_id: "RT1", agent: { name: "planner-sonnet" }, data: { model_requested: "sonnet" } }),
  ev("tool.post", { run_id: "run_R1", task_id: "RT1", agent: { name: "planner-sonnet" }, data: {} }),
  ev("subagent.stop", { run_id: "run_R1", task_id: "RT1", agent: { name: "planner-sonnet" }, data: { status: "completed", duration_ms: 4200, model_resolved: "claude-sonnet-5-5" } }),
  ev("handoff.pointer", { run_id: "run_R1", task_id: "RT1", agent: { name: "planner-sonnet" }, data: { status: "completed", next_agent: "coder-sonnet" } }),
  ev("run.state", { run_id: "run_R1", task_id: "RT1", agent: { name: "main" }, data: { state: "running" } }),
  ev("subagent.start", { run_id: "run_R2", task_id: "RT2", agent: { name: "coder-sonnet" }, data: {} }),
  ev("subagent.stop", { run_id: "run_R2", task_id: "RT2", agent: { name: "coder-sonnet" }, data: { status: "completed", duration_ms: 9000 } }),
  ev("subagent.start", { run_id: "run_R2", task_id: "RT2", agent: { name: "reviewer-opus" }, data: {} }),
  ev("usage.report", { run_id: "run_R2", task_id: "RT2", agent: { name: "coder-sonnet" }, data: { tokens: { input: 10, cache_write: 20, cache_read: 30, output: 40 } } }),
  ev("usage.report", { run_id: "run_R2", task_id: "RT2", agent: { name: "coder-sonnet" }, data: { tokens: { input: 1, cache_write: 2, cache_read: 3, output: 4 } } }),
  "linha quebrada {",
];
grava(cheio, ".claude/telemetry-spool.jsonl", eventos.join("\n") + "\n");
grava(cheio, "scripts/telemetria/relatorio-custos.mjs", `console.log(JSON.stringify([
 {sessao:"abcdef123456",papel:"sessao-principal",modelo:"claude-opus-5-5",tok:{entrada:100,escrita:200,releitura:700,saida:50},custoTotal:1.5,chamadasN:3,razao:1},
 {sessao:"fedcba654321",papel:"coder-sonnet",modelo:"claude-sonnet-5-5",tok:{entrada:10,escrita:20,releitura:70,saida:5},custoTotal:0.25,chamadasN:2,razao:1.1}]))`);

// ---------- fixture vazia ----------
const vazio = join(base, "vazio");
mkdirSync(vazio, { recursive: true });

const mod = await import(pathToFileURL(SERVE).href);
let S, V; // servidores

caso("sobe e /api/state tem o formato esperado", async () => {
  S = await sobe(cheio);
  const r = await pega(S.porta);
  afirma(r.status === 200 && /application\/json/.test(r.headers["content-type"]), "status/tipo");
  const s = JSON.parse(r.body);
  for (const k of ["gerado", "projeto", "adrs", "tasks", "eventos", "agentes", "fluxos", "tokens", "telemetria"]) afirma(k in s, "falta " + k);
  for (const k of ["fases", "decisoes", "bloqueios", "aprovacoes", "pendencias_manuais"]) afirma(Array.isArray(s.projeto[k]), "projeto." + k);
  afirma(!/\[object Object\]/.test(r.body), "[object Object] no estado");
});
caso("/ serve a página; método não GET é 405; rota desconhecida 404", async () => {
  const h = await pega(S.porta, "/");
  afirma(h.status === 200 && /<title>/.test(h.body), "página");
  igual((await pega(S.porta, "/api/state", { method: "POST" })).status, 405, "POST");
  igual((await pega(S.porta, "/gestao/projeto.json")).status, 404, "arquivo cru não é servido");
});
caso("Host fora do loopback é recusado (DNS rebinding)", async () => {
  igual((await pega(S.porta, "/api/state", { headers: { host: "evil.example.com" } })).status, 403, "host");
});
caso("escuta só em loopback (sem acesso pelo IP da rede)", async () => {
  const ext = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  afirma(/listen\(PORT, HOST/.test(readFileSync(SERVE, "utf8")) && /HOST = '127\.0\.0\.1'/.test(readFileSync(SERVE, "utf8")), "listen em HOST loopback");
  if (!ext) return;
  const recusou = await new Promise((ok) => { const r = http.request({ host: ext.address, port: S.porta, path: "/api/state", timeout: 2000 }, () => ok(false)); r.on("error", () => ok(true)); r.on("timeout", () => { r.destroy(); ok(true); }); r.end(); });
  afirma(recusou, "respondeu em " + ext.address);
});
caso("ADRs: docs/adr/*.md e docs/ADR-*.md, sem prefixo fixo, título e Status", async () => {
  const s = await estado(S.porta);
  const por = Object.fromEntries(s.adrs.map((a) => [a.arquivo, a]));
  igual(Object.keys(por).sort(), ["0001-primeiro.md", "ACME-D07-segundo.md", "ADR-010-nota-01-x.md", "ADR-010-terceiro.md"], "arquivos");
  igual([por["0001-primeiro.md"].id, por["0001-primeiro.md"].titulo, por["0001-primeiro.md"].status], ["0001", "Primeiro", "Aceito"], "0001");
  igual([por["ACME-D07-segundo.md"].id, por["ACME-D07-segundo.md"].status], ["ACME-D07", "Proposto — falta spike"], "ACME (CRLF)");
  igual([por["ADR-010-terceiro.md"].id, por["ADR-010-terceiro.md"].titulo], ["ADR-010", "Terceiro"], "ADR-010");
  igual(por["ADR-010-nota-01-x.md"].titulo, "Nota", "nota");
});
caso("parseAdr isolado: sem Status vira '?'", () => {
  const a = mod.parseAdr("x.md", "# Sem status\n");
  igual([a.status, a.titulo], ["?", "Sem status"], "parseAdr");
});
caso("tasks: brief, run-log, estados e _TEMPLATE ignorado", async () => {
  const s = await estado(S.porta);
  igual(s.tasks.map((t) => t.id), ["2026-11-01_um", "2026-11-02_dois", "2026-11-03_tres"], "ids");
  const [um, dois, tres] = s.tasks;
  igual([um.complexidade, um.sensivel, um.objetivo, um.estado, um.artifacts], ["média", "sim", "Fazer o um.", "em curso", ["planner.md"]], "um");
  igual([dois.estado, tres.estado], ["blocked", "done"], "estados");
  igual(um.log.length, 3, "linhas do run-log");
  igual(mod.parseRunLog("| 2026-01-01 10:00 | a | b | c | d |")[0], { ts: "2026-01-01 10:00", agent: "a", event: "b", status: "c", ref: "d" }, "parseRunLog");
  igual(mod.parseRunLog(null), [], "parseRunLog vazio");
});
caso("agente-objeto normalizado para texto; 'main' não é subagente", async () => {
  const s = await estado(S.porta);
  afirma(s.eventos.every((e) => e.agent === null || typeof e.agent === "string"), "agent não é texto");
  afirma(s.eventos.some((e) => e.agent === "planner-sonnet"), "planner some");
  afirma(!s.agentes.some((a) => a.nome === "main") && !s.fluxos.some((f) => f.passos.some((p) => p.agent === "main")), "main virou agente");
  igual([mod.nomeAgente({ name: "main" }), mod.nomeAgente({ name: "x" }), mod.nomeAgente("y"), mod.nomeAgente(undefined), mod.nomeAgente({})], [null, "x", "y", null, null], "nomeAgente");
  const planner = s.agentes.find((a) => a.nome === "planner-sonnet");
  igual([planner.execucoes, planner.ferramentas, planner.estado, planner.modelo, planner.esforco], [1, 1, "ocioso", "sonnet", "medium"], "estado do agente");
  igual(s.agentes.find((a) => a.nome === "reviewer-opus").estado, "ativo", "reviewer ativo");
});
caso("fluxo montado dos eventos: ordem real, modelo/esforço, próximo tracejado", async () => {
  const s = await estado(S.porta);
  const r1 = s.fluxos.find((f) => f.id === "run_R1"), r2 = s.fluxos.find((f) => f.id === "run_R2");
  igual(r1.passos.map((p) => p.agent), ["planner-sonnet"], "R1 passos");
  const p = r1.passos[0];
  igual([p.estado, p.duracao_ms, p.modelo, p.modelo_origem, p.esforco], ["concluido", 4200, "claude-sonnet-5-5", "real", "medium"], "planner");
  igual([r1.proximo, r1.esforcoSessao, r1.emExecucao], ["coder-sonnet", "xhigh", true], "R1 proximo/esforço/ativo");
  igual(r2.passos.map((x) => x.agent), ["coder-sonnet", "reviewer-opus"], "R2 ordem");
  igual([r2.passos[0].modelo, r2.passos[0].modelo_origem, r2.passos[0].esforco], ["sonnet", "configurado", "high"], "coder (config)");
  igual([r2.passos[1].estado, r2.passos[1].modelo, r2.passos[1].esforco], ["ativo", "opus", "xhigh"], "reviewer ativo");
  afirma(r2.emExecucao && s.fluxos[0].emExecucao, "em execução primeiro");
});
caso("sem telemetria da task, o fluxo é reconstruído do run-log", async () => {
  const s = await estado(S.porta);
  const f = s.fluxos.find((x) => x.id === "2026-11-01_um");
  afirma(f && f.origem === "run-log", "fluxo do run-log");
  igual(f.passos.map((p) => [p.agent, p.estado]), [["planner-sonnet", "concluido"], ["coder-sonnet", "ativo"]], "passos");
  afirma(f.emExecucao, "task em curso aparece como em execução");
  afirma(!f.passos.some((p) => /orchestr/i.test(p.agent)), "orchestrator no desenho");
});
caso("fluxo isolado: execução parada há horas não fica 'em execução'", () => {
  const e = (type, extra) => ({ ts: new Date(agora - 5 * 3600e3).toISOString(), type, run_id: "run_Z", ...extra });
  const f = mod.fluxos([e("subagent.start", { agent: "a" })], [], {}, agora);
  igual([f[0].passos[0].estado, f[0].emExecucao], ["ativo", false], "velho");
  igual(mod.fluxos([], [], {}, agora), [], "sem eventos");
});
caso("tokens: agregados por tipo, papel, modelo, cache hit e ao vivo", async () => {
  const t = (await estado(S.porta)).tokens;
  igual([t.total.entrada, t.total.escrita, t.total.releitura, t.total.saida], [110, 220, 770, 55], "total");
  afirma(Math.abs(t.total.custo - 1.75) < 1e-9, "custo " + t.total.custo);
  afirma(Math.abs(t.cacheHit - 770 / 1100) < 1e-9, "cache hit " + t.cacheHit);
  igual(Object.keys(t.porPapel).sort(), ["coder-sonnet", "sessao-principal"], "porPapel");
  igual(Object.keys(t.porModelo).sort(), ["claude-opus-5-5", "claude-sonnet-5-5"], "porModelo");
  igual(t.sessoes.map((x) => x.id), ["abcdef12", "fedcba65"], "sessões");
  igual(t.live["coder-sonnet"], { entrada: 11, escrita: 22, releitura: 33, saida: 44, n: 2 }, "ao vivo");
  igual(mod.agregarTokens([{ papel: "x" }, null].filter(Boolean), []).linhas, 0, "linha sem tok é ignorada");
});
caso("projeto: bloqueios com resolução, decisões com e sem resposta", async () => {
  const P = (await estado(S.porta)).projeto;
  const b = P.bloqueios[0];
  igual([b.id, b.gravidade, b.resolver, b.pronto_quando, b.dono, b.arquivos, b.depende_de], ["B1", "alta", ["passo 1", "passo 2"], "quando", "dev", ["a.md"], []], "bloqueio");
  igual(P.fases[0].itens[1].bloqueio_id, "B1", "item aponta o bloqueio");
  const [q1, q2] = P.decisoes;
  afirma(!q1.resposta && q1.opcoes.length === 2, "pendente");
  igual([q2.resposta, q2.por, q2.data, q2.registro], ["y", "dev", "2026-11-11", "docs/adr/0002-x.md"], "respondida");
});
caso("telemetria: detectada pelo settings.local.json (servidor sem o env) e pelos eventos", async () => {
  const T = (await estado(S.porta)).telemetria;
  igual([T.configurada, T.modo, T.projeto_id], [true, "spool local", "x"], "via settings");
  afirma(T.eventos === 11 && T.ultimo, "eventos " + T.eventos);
  const so = join(base, "so-eventos");
  grava(so, ".claude/telemetry-spool.jsonl", ev("session.start", { agent: { name: "main" } }) + "\n");
  const srv = await sobe(so);
  try {
    const T2 = (await estado(srv.porta)).telemetria;
    igual([T2.configurada, T2.modo], [true, "eventos encontrados"], "via eventos");
  } finally { srv.p.kill(); }
});
caso("projeto vazio: sobe, gera gestao/projeto.json e mostra estados vazios", async () => {
  V = await sobe(vazio);
  const s = await estado(V.porta);
  igual([s.adrs, s.tasks, s.eventos, s.fluxos], [[], [], [], []], "listas");
  igual([s.telemetria.configurada, s.telemetria.modo, s.telemetria.eventos], [false, "desligada", 0], "telemetria desligada");
  igual([s.tokens.total.custo, s.tokens.linhas, s.tokens.live], [0, 0, {}], "tokens vazios");
  afirma(existe(vazio, "gestao/projeto.json") && s.projeto.erro === null, "projeto.json gerado");
  afirma(!/\[object Object\]/.test(JSON.stringify(s)), "[object Object]");
});
const existe = (raiz, rel) => existsSync(join(raiz, rel));
caso("sem projeto.json e COM template: copia o template", async () => {
  const r = join(base, "com-template");
  grava(r, "gestao/projeto.template.json", { ...TEMPLATE, nome: "Do template" });
  const srv = await sobe(r);
  try {
    igual((await estado(srv.porta)).projeto.nome, "Do template", "nome");
    afirma(existe(r, "gestao/projeto.json"), "arquivo gerado");
  } finally { srv.p.kill(); }
});
caso("projeto.json inválido não derruba o portal", async () => {
  const r = join(base, "invalido");
  grava(r, "gestao/projeto.json", "{ isto nao e json");
  const srv = await sobe(r);
  try {
    const P = (await estado(srv.porta)).projeto;
    afirma(/inválido/.test(P.erro) && P.fases.length === 0, "erro e listas vazias");
  } finally { srv.p.kill(); }
});
caso("projeto.json de campos faltando/tipos errados é normalizado", async () => {
  const r = join(base, "torto");
  grava(r, "gestao/projeto.json", { nome: 5, fases: "x", bloqueios: [{ id: "B9" }, null], decisoes: [{ id: "Q" }] });
  const srv = await sobe(r);
  try {
    const P = (await estado(srv.porta)).projeto;
    igual([P.nome, P.fases, P.bloqueios[0].resolver, P.decisoes[0].opcoes], ["Projeto", [], [], []], "normalização");
    igual(P.bloqueios.length, 1, "null descartado");
  } finally { srv.p.kill(); }
});
caso("template do playbook: completo (bloqueio, decisão pendente e respondida) e válido", () => {
  const b = TEMPLATE.bloqueios[0];
  for (const k of ["id", "titulo", "desde", "gravidade", "bloqueia", "causa", "resolver", "pronto_quando", "dono", "arquivos", "depende_de"]) afirma(k in b, "bloqueio sem " + k);
  afirma(TEMPLATE.fases.some((f) => f.itens.some((i) => i.bloqueio_id === b.id)), "item aponta o bloqueio");
  afirma(TEMPLATE.decisoes.some((d) => !d.resposta) && TEMPLATE.decisoes.some((d) => d.resposta && d.por && d.data), "decisões");
  for (const k of ["nome", "fases", "aprovacoes", "pendencias_manuais"]) afirma(k in TEMPLATE, "template sem " + k);
  igual(JSON.parse(readFileSync(resolve("gestao/projeto.json"), "utf8")), TEMPLATE, "projeto.json do playbook = template");
});
caso("página: escape de HTML, polling sem redesenho redundante e <details> preservados", () => {
  const trecho = HTML.match(/const esc=(.*)\n/)[1].replace(/;?$/, "");
  const esc = vm.runInNewContext("(" + trecho + ")");
  igual(esc('<script>"a"&\'b\'</script>'), "&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;", "esc");
  igual([esc(null), esc(undefined), esc(0)], ["", "", "0"], "esc vazio");
  afirma(/setInterval\(tick,3000\)/.test(HTML), "polling 3 s");
  afirma(/JSON\.stringify\(\{\.\.\.s,gerado:0\}\)/.test(HTML) && /if\(sig!==ULTIMO\)/.test(HTML), "compara sem carimbo");
  afirma(/sessionStorage/.test(HTML) && /details\[data-id\]/.test(HTML) && /aberto\('b:'\+b\.id\)/.test(HTML), "estado dos details");
  // todo campo vindo de arquivo passa por esc() ou por helper que escapa
  const cru = [...HTML.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).filter((x) => /\b(?:b|d|a|i|p|f|t|x|e)\.(?:titulo|pergunta|resposta|t|nome|objetivo|agent|modelo|status|id)\b/.test(x) && !/esc\(|pill\(|par\(|lista\(|fmt\(|usd\(|aberto\(|\?/.test(x));
  igual(cru, [], "interpolações sem escape");
});
caso("brief no formato do _TEMPLATE: complexidade e Sensivel (security gate) lidos; o portal depende dos rotulos **Campo:**", async () => {
  const modelo = readFileSync(resolve("tasks/_TEMPLATE/brief.md"), "utf8");
  // O portal le estes rotulos do _TEMPLATE: mudar o formato **Campo:** exige mudar campoBrief em gestao/serve.mjs.
  afirma(modelo.includes("**Complexidade:**") && modelo.includes("**Sensível (security gate):**"), "rotulos do _TEMPLATE mudaram");
  const linhas = modelo.split(String.fromCharCode(13)).join("").split(String.fromCharCode(10)).map((l) => l.startsWith("**Complexidade:**") ? "**Complexidade:** complexa" : l.startsWith("**Sensível (security gate):**") ? "**Sensível (security gate):** sim — toca auth" : l);
  const r = join(base, "brief-real");
  grava(r, "tasks/_TEMPLATE/brief.md", modelo);
  grava(r, "tasks/2026-11-11_real/brief.md", linhas.join(String.fromCharCode(10)).replace("{Uma frase: o que estará verdadeiro quando a task estiver pronta.}", "Objetivo real."));
  const srv = await sobe(r);
  try {
    const t = (await estado(srv.porta)).tasks.find((x) => x.id === "2026-11-11_real");
    igual([t.complexidade, t.sensivel, t.objetivo], ["complexa", "sim", "Objetivo real."], "campos");
  } finally { srv.p.kill(); }
});
caso("brief malformado nao derruba o processo", async () => {
  const r = join(base, "malformado");
  grava(r, "tasks/a/brief.md", ["**Complexidade:**", "**Sensível (security gate):**", "## Objetivo", String.fromCharCode(0, 0xd800) + " ((( ** [[[ " + String.fromCharCode(92), "x".repeat(200000)].join(String.fromCharCode(10)));
  grava(r, "tasks/b/brief.md", "");
  const srv = await sobe(r);
  try {
    const res = await pega(srv.porta);
    afirma(res.status === 200 && Array.isArray(JSON.parse(res.body).tasks), "status " + res.status);
    afirma(srv.p.exitCode === null, "processo caiu");
  } finally { srv.p.kill(); }
});
caso("erro ao montar o estado: /api/state responde 500 em JSON e o processo continua no ar", async () => {
  const srv = await sobe(vazio, { GESTAO_TEST_FALHA: "boom" });
  try {
    const res = await pega(srv.porta);
    afirma(res.status === 500 && res.headers["content-type"].includes("application/json") && res.headers["cache-control"] === "no-store", "status/cabecalhos " + res.status);
    igual(JSON.parse(res.body), { erro: "falha ao montar o estado", detalhe: "boom" }, "corpo");
    igual((await pega(srv.porta, "/")).status, 200, "pagina ainda serve");
    afirma(srv.p.exitCode === null, "processo caiu");
  } finally { srv.p.kill(); }
});
caso("handlers de uncaughtException e unhandledRejection so registram", () => {
  const src = readFileSync(SERVE, "utf8");
  afirma(src.includes("process.on('uncaughtException', (e) => console.error") && src.includes("process.on('unhandledRejection', (e) => console.error"), "handlers");
});
caso("start sem task_id e stop com task_id viram UM fluxo (religa por agent_id); tool.* sem agent_type resolve o papel", async () => {
  const r = join(base, "religa");
  const T = "2026-11-11_fundacao-monorepo";
  grava(r, "tasks/" + T + "/brief.md", "# b");
  grava(r, ".claude/agents/architect.md", "---" + String.fromCharCode(10) + "name: architect-opus" + String.fromCharCode(10) + "model: opus" + String.fromCharCode(10) + "effort: high" + String.fromCharCode(10) + "---" + String.fromCharCode(10));
  grava(r, ".claude/agents/planner.md", "---" + String.fromCharCode(10) + "name: planner-sonnet" + String.fromCharCode(10) + "model: sonnet" + String.fromCharCode(10) + "effort: medium" + String.fromCharCode(10) + "---" + String.fromCharCode(10));
  const S1 = "sess-1";
  const linhas = [
    ev("subagent.start", { session_id: S1, agent: { name: "architect", type: "architect-opus", instance_id: "A1" }, data: { agent_id: "A1", agent_type: "architect-opus", role: "architect" } }),
    ev("subagent.stop", { session_id: S1, task_id: T, agent: { name: "architect", type: "architect-opus", instance_id: "A1" }, data: { agent_id: "A1", agent_type: "architect-opus", status: "completed", duration_ms: 16000 } }),
    ev("subagent.start", { session_id: S1, task_id: T, agent: { name: "planner", type: "planner-sonnet", instance_id: "P1" }, data: { agent_id: "P1", agent_type: "planner-sonnet", task_source: "sticky" } }),
    ev("tool.post", { session_id: S1, task_id: T, agent: { name: "planner" }, data: {} }),
    ev("tool.post", { session_id: S1, task_id: T, agent: { name: "planner", instance_id: "P1" }, data: {} }),
  ];
  grava(r, ".claude/telemetry-spool.jsonl", linhas.join(String.fromCharCode(10)) + String.fromCharCode(10));
  const srv = await sobe(r);
  try {
    const s = await estado(srv.porta);
    const f = s.fluxos.filter((x) => x.task === T);
    igual(f.length, 1, "um fluxo só");
    igual(s.fluxos.length, 1, "nenhum fluxo órfão sem task");
    igual(f[0].passos.map((p) => [p.agent, p.estado]), [["architect-opus", "concluido"], ["planner-sonnet", "ativo"]], "passos");
    igual([f[0].passos[0].modelo, f[0].passos[0].esforco], ["opus", "high"], "modelo/esforço do architect");
    const st = s.eventos[0];
    igual([st.task_id, st.task_inferido], [T, true], "start religado");
    const pl = s.agentes.find((a) => a.nome === "planner-sonnet");
    igual([pl.execucoes, pl.ferramentas], [1, 2], "tool.* contado no agente completo");
    afirma(!s.agentes.some((a) => a.nome === "planner" || a.nome === "architect"), "papel solto virou agente");
  } finally { srv.p.kill(); }
});
caso("vincularEventos: sem agent_id cai na sessão; sessão com duas tasks não adivinha", () => {
  const e = (extra) => ({ type: "tool.post", ts: "2026-11-11T10:00:00Z", ...extra });
  const a = mod.vincularEventos([e({ session_id: "s", task_id: "T1" }), e({ session_id: "s" })]);
  igual([a[1].task_id, a[1].task_inferido], ["T1", true], "sessão com uma task");
  const b = mod.vincularEventos([e({ session_id: "s", task_id: "T1" }), e({ session_id: "s", task_id: "T2" }), e({ session_id: "s" })]);
  igual(b[2].task_id, undefined, "ambígua");
  const c = mod.vincularEventos([e({ run_id: "run_X", task_id: "T9" }), e({ run_id: "run_X", session_id: "z" })]);
  igual(c[1].task_id, "T9", "pelo run_id");
  const d = mod.vincularEventos([e({ agent: "planner" })], { "planner-sonnet": {}, "planner-opus": {} });
  igual(d[0].agent, "planner", "papel ambíguo não é adivinhado");
});
caso("sem dependências: serve.mjs importa só módulos nativos", () => {
  const imps = [...readFileSync(SERVE, "utf8").matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  afirma(imps.length > 0 && imps.every((m) => m.startsWith("node:")), "import externo: " + imps.join(","));
});
caso("não duplica a lógica de preço: usa relatorio-custos.mjs --json", () => {
  const src = readFileSync(SERVE, "utf8");
  afirma(/relatorio-custos\.mjs/.test(src) && /'--json'/.test(src) && !/precos\.json/.test(src.replace(/\/\/.*$/gm, "")), "reuso");
});
caso("segundo plano: painel.mjs inicia, é idempotente, informa status e para (mesmo comando em todo SO)", async () => {
  const { spawnSync } = await import("node:child_process");
  const net = await import("node:net");
  const porta = await new Promise((ok) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(() => ok(n)); }); });
  const r = join(base, "bg"); mkdirSync(r, { recursive: true });
  const roda = (c) => spawnSync(process.execPath, [resolve("gestao/painel.mjs"), c], { encoding: "utf8", env: { ...process.env, GESTAO_PORT: String(porta), GESTAO_ROOT: r } });
  try {
    afirma(/iniciado/.test(roda("iniciar").stdout), "primeiro iniciar");
    afirma((await pega(porta)).status === 200, "no ar");
    afirma(/já está rodando/.test(roda("start").stdout), "segundo iniciar é idempotente");
    afirma(/no ar/.test(roda("status").stdout), "status");
    afirma(/parado/.test(roda("parar").stdout), "parar");
    afirma(/não estava rodando/.test(roda("stop").stdout), "parar de novo é idempotente");
    afirma(/Portal parado/.test(roda("status").stdout), "status parado");
    igual(roda("xyz").status, 1, "comando inválido");
  } finally { roda("parar"); }
});
caso("wrappers ps1/sh só delegam ao painel.mjs; nada de tarefa agendada nem alteração de sistema", () => {
  const w = ["iniciar.ps1", "parar.ps1", "iniciar.sh", "parar.sh"].map((f) => { afirma(existsSync(resolve("gestao", f)), "falta " + f); return readFileSync(resolve("gestao", f), "utf8"); });
  afirma(w.every((x) => x.includes("painel.mjs")), "wrapper sem painel.mjs");
  const todos = w.join(" ") + readFileSync(resolve("gestao/painel.mjs"), "utf8");
  afirma(!/schtasks|Register-ScheduledTask|crontab|launchctl|systemctl|reg add/i.test(todos), "altera o sistema");
});

let ok = 0;
for (const [nome, fn] of casos) {
  try { await fn(); ok++; console.log("  ok   " + nome); }
  catch (e) { console.log("  FALHA " + nome + "\n        " + String(e.message).split("\n")[0]); }
}
for (const x of [S, V]) if (x) x.p.kill();
try { rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${ok}/${casos.length}`);
process.exit(ok === casos.length ? 0 : 1);
