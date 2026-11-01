#!/usr/bin/env node
// Smoke test do fluxo .claude/workflows/playbook-task.js com agent() simulado.
// Uso: node scripts/test-playbook-task.mjs [caminho-do-script]
//
// Roda o corpo do script como o runtime do Workflow faz (top-level await/return, sem
// filesystem) e confere, por cenário, o status devolvido, quem foi chamado e o que o script
// disse a cada agente. Não gasta quota: nenhum modelo é chamado. Rode antes de propor
// qualquer mudança no script (GOVERNANCE.md §6.2) — o caso novo entra aqui junto.
import { readFileSync } from "node:fs";

const PATH = process.argv[2] || ".claude/workflows/playbook-task.js";
const src = readFileSync(PATH, "utf8").replace(/^export const meta/m, "const meta");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", "workflow", src);

const OK = (agent) => ({ agent, aprovado: true, issues: [], artifact_path: `artifacts/${agent}.md` });
const NOK = (agent) => ({ agent, aprovado: false, issues: [{ severity: "HIGH", summary: `defeito visto por ${agent}` }], artifact_path: `artifacts/${agent}.md` });
const PTR = (agent, status = "completed") => ({
  agent, model: "claude-opus-5-5", task_id: "t", status, artifact_path: `artifacts/${agent}.md`,
  files_changed: [], next_agent: "-", context_for_next: "-", blockers: status === "blocked" ? ["falta X"] : [], skill_candidates: [],
});
const RECON = (o = {}) => ({ complexity: "media", sensitive: false, sensitive_reasons: [], needs_spec: false, data_migration: false, files: ["a.ts"], summary: "-", ...o });

// Cada cenário responde por label; função recebe (rodada) quando o label varia por rodada.
async function run({ args, answers }) {
  const calls = [];
  let round = 0;
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || "?";
    const m = /^coder r(\d+)/.exec(label);
    if (m) round = Number(m[1]);
    calls.push({ label, prompt, agentType: opts.agentType, schema: opts.schema, model: opts.model });
    const key = Object.keys(answers).find((k) => label === k || label.startsWith(k + " "));
    const a = key === undefined ? undefined : answers[key];
    if (Array.isArray(a)) return a.length > 1 ? a.shift() : a[0];   // sequência por chamada; o último se repete
    return typeof a === "function" ? a(round) : a;
  };
  const lotes = [];
  const parallel = async (thunks) => { lotes.push(thunks.length); return Promise.all(thunks.map((t) => t().catch(() => null))); };
  let res, err;
  try {
    res = await body(args, agent, parallel, async () => [], () => {}, () => {}, { total: null }, async () => null);
  } catch (e) { err = e; }
  return { res, err, calls, lotes, labels: calls.map((c) => c.label) };
}

const T = "2026-09-23_smoke";
const CP = (agent, n = 1) => ({ ...PTR(agent, "checkpoint"), artifact_path: `artifacts/${agent}-checkpoint-0${n}.md` });
const ORC = { paralelismo_max_agentes: 2, checkpoint: { tool_calls_por_faixa: { trivial: 15, simples: 15, media: 30, complexa: 50 }, contexto_agente_tokens: 150000, max_por_fatia: 3 },
  comandos_longos: { background_acima_segundos: 180, polling_segundos: 120, sem_chamada_max_segundos: 270 }, saida_ferramenta: { leitura_max_linhas_sem_justificativa: 400, saida_para_arquivo_linhas: 150 } };
const CASES = [
  ["task_id inválido lança erro", { args: { task_id: "x" }, answers: {} },
    (r) => r.err && /task_id/.test(r.err.message)],

  ["recon sem retorno → blocked", { args: { task_id: T }, answers: { recon: null } },
    (r) => r.res.status === "blocked" && /recon/.test(r.res.erro)],

  ["trivial aprovada → done, sem Tester, Coder dono dos testes",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.res.sensitive === false && !r.labels.includes("tester")
      && /o dono é você/.test(r.calls.find((c) => c.label === "coder r1").prompt)],

  ["média, reprova 2× → escalado",
    { args: { task_id: T }, answers: { recon: RECON(), architect: PTR("architect"), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"), review: NOK("reviewer") } },
    (r) => r.res.status === "escalado" && r.labels.filter((l) => l.startsWith("coder")).length === 2],

  ["coder bloqueado → blocked em coder",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder", "blocked"), tester: PTR("tester") } },
    (r) => r.res.status === "blocked" && r.res.em === "coder"],

  ["recon eleva a sensível: 3 lentes, r2 aprova, cego aprova → done sensitive",
    { args: { task_id: T, sensitive: false }, answers: {
        recon: RECON({ sensitive: true }), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": (n) => (n === 1 ? NOK("reviewer") : OK("reviewer")),
        "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => r.res.status === "done" && r.res.sensitive === true
      && r.labels.filter((l) => l === "tester").length === 1
      && /o dono é você/.test(r.calls.find((c) => c.label === "coder r2").prompt)
      && r.labels.length === 13],

  ["refutador cego sem retorno → blocked (fail-closed)",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": null } },
    (r) => r.res.status === "blocked" && r.res.em === "refutador cego"],

  ["refutador cego reprova → divergencia",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": NOK("reviewer") } },
    (r) => r.res.status === "divergencia" && r.res.issues.length === 1],

  ["lente ausente → blocked em lentes, sem gastar rodada do Coder",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": null, "lente: reprodução": OK("tester") } },
    (r) => r.res.status === "blocked" && r.res.em === "lentes" && !r.labels.includes("coder r2") && !r.labels.includes("refutador cego")],

  ["reviewer sem retorno (task normal) → blocked em reviewer",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"), review: null } },
    (r) => r.res.status === "blocked" && r.res.em === "reviewer" && !r.labels.includes("coder r2")],

  ["épica com Planner sem retorno → blocked, nunca fatiada vazia",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "epica" }), "fatiar épica": null } },
    (r) => r.res.status === "blocked" && r.res.em === "planner"],

  ["brief sensível e recon não → segue sensível (nunca rebaixa)",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON({ complexity: "trivial", sensitive: false }), coder: PTR("coder"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => r.res.status === "done" && r.res.sensitive === true && r.labels.includes("refutador cego")],

  ["épica → fatiada, sem Coder",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "epica", sensitive: true }), "fatiar épica": { slices: [{ slug: "a", objective: "-", files: [] }] } } },
    (r) => r.res.status === "fatiada" && r.res.slices.length === 1 && r.res.sensitive === true && !r.labels.some((l) => l.startsWith("coder"))],

  ["spec quando needs_spec", { args: { task_id: T }, answers: {
        recon: RECON({ needs_spec: true }), spec: PTR("spec-writer"), design: PTR("architect"), plan: PTR("planner"),
        coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.labels.includes("spec")],

  ["todo retorno carrega task_id e events", { args: { task_id: T }, answers: { recon: RECON(), design: null } },
    (r) => r.res.status === "blocked" && r.res.task_id === T && Array.isArray(r.res.events)],

  ["POINTER declara provider e needs_human como opcionais (HANDOFF §3.2)",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => {
      const schema = r.calls.find((c) => c.label === "coder r1").schema;
      const human = schema.properties.needs_human;
      return r.res.status === "done" && schema.properties.provider.type === "string"
        && !schema.required.includes("provider") && !schema.required.includes("needs_human")
        && human.anyOf.some((s) => s.type === "boolean")
        && human.anyOf.some((s) => s.type === "object" && s.required.includes("question"));
    }],

  ["ponteiro sem os opcionais → events sem provider nem needs_human (compatível)",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.res.events.every((e) => !("provider" in e) && !("needs_human" in e))],

  ["provider e needs_human não bloqueante → done, os dois nos events do agente",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), review: OK("reviewer"),
        coder: { ...PTR("coder"), provider: "provedor-b", needs_human: { question: "manter o limite atual?", blocking: false } } } },
    (r) => {
      const ev = r.res.events.find((e) => e.agent === "coder");
      return r.res.status === "done" && ev.provider === "provedor-b" && ev.needs_human.question === "manter o limite atual?"
        && !("needs_human" in r.res);
    }],

  ["coder bloqueado com needs_human → blocked em coder, pergunta no retorno, sem review",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), tester: PTR("tester"),
        coder: { ...PTR("coder", "blocked"), needs_human: { question: "qual contrato vale?", options: ["v1", "v2"], blocking: true } } } },
    (r) => r.res.status === "blocked" && r.res.em === "coder" && r.res.needs_human.options.length === 2
      && r.res.blockers.length === 1 && !r.labels.some((l) => l === "review" || l.startsWith("lente"))],

  ["architect bloqueado com needs_human: true → blocked em architect, needs_human no retorno",
    { args: { task_id: T }, answers: { recon: RECON(), design: { ...PTR("architect", "blocked"), needs_human: true } } },
    (r) => r.res.status === "blocked" && r.res.em === "architect" && r.res.needs_human === true && !r.labels.includes("plan")],

  // ---------- ADR-009: eficiência de contexto ----------
  ["POINTER aceita status checkpoint e VERDICT declara escopo_excedido opcional",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => {
      const ptr = r.calls.find((c) => c.label === "coder r1").schema;
      const ver = r.calls.find((c) => c.label.startsWith("review")).schema;
      return ptr.properties.status.enum.includes("checkpoint") && ver.properties.escopo_excedido.type === "boolean" && !ver.required.includes("escopo_excedido");
    }],

  ["coder em checkpoint → agente novo continua do checkpoint → done",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: [CP("coder"), PTR("coder")], review: OK("reviewer") } },
    (r) => {
      const cont = r.calls.find((c) => /continuação 1/.test(c.label));
      return r.res.status === "done" && r.res.checkpoints === 1
        && r.res.events.some((e) => e.agent === "coder" && e.status === "checkpoint" && e.ref === "artifacts/coder-checkpoint-01.md")
        && cont && cont.agentType === "coder-sonnet" && /CONTINUAÇÃO 1[\s\S]*artifacts\/coder-checkpoint-01\.md/.test(cont.prompt)
        && cont.prompt.startsWith(r.calls.find((c) => c.label === "coder r1").prompt);
    }],

  ["checkpoints acima do teto da fatia → escalado ao Planner, sem review",
    { args: { task_id: T, orcamento: ORC }, answers: { recon: RECON({ complexity: "trivial" }), coder: [CP("coder", 1), CP("coder", 2), CP("coder", 3), CP("coder", 4)], review: OK("reviewer") } },
    (r) => r.res.status === "escalado" && r.res.para === "planner" && r.res.checkpoints === 4 && r.res.checkpoint === "artifacts/coder-checkpoint-04.md"
      && !r.labels.some((l) => l.startsWith("review"))],

  ["tester em checkpoint na rodada paralela também continua",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: [CP("tester"), PTR("tester")], review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.res.checkpoints === 1 && r.labels.some((l) => /^tester · continuação 1$/.test(l))],

  ["reviewer com escopo_excedido → blocked em review, nunca done, sem gastar rodada",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        review: { ...OK("reviewer"), aprovado: false, escopo_excedido: true } } },
    (r) => r.res.status === "blocked" && r.res.em === "review" && r.res.escopo_excedido === true && !r.labels.includes("coder r2")],

  ["lente com escopo_excedido, mesmo 'aprovando' → blocked, sem refutador",
    { args: { task_id: T, sensitive: true }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": { ...OK("reviewer"), escopo_excedido: true }, "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => r.res.status === "blocked" && r.res.em === "review" && !r.labels.includes("refutador cego")],

  ["prefixo estável: prompt começa igual para todo agente e o task_id só aparece depois de '## Esta task'",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON({ needs_spec: true }), spec: PTR("spec-writer"), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => {
      const pre = r.calls[0].prompt.split("\n").slice(0, 3).join("\n");
      return r.res.status === "done" && r.calls.every((c) => c.prompt.startsWith(pre))
        && r.calls.every((c) => { const i = c.prompt.indexOf("## Esta task"); return i > 0 && !c.prompt.slice(0, i).includes(T) && !c.prompt.slice(0, i).includes(`tasks/${T}`); });
    }],

  ["orçamento do perfil chega ao prompt (limiares por faixa, comando longo, leitura)",
    { args: { task_id: T, orcamento: ORC }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => { const p = r.calls[0].prompt; return /simples 15, media 30, complexa 50/.test(p) && /180 s/.test(p) && /270 s/.test(p) && /400 linhas/.test(p); }],

  ["sem orçamento: prompt aponta para o perfil, sem número inventado",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => /praticas\/00 → bloco orcamento-contexto/.test(r.calls[0].prompt)],

  ["teto de paralelismo 2: as 3 lentes rodam em lotes de 2 + 1",
    { args: { task_id: T, sensitive: true, orcamento: ORC }, answers: {
        recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => r.res.status === "done" && Math.max(...r.lotes) <= 2 && r.labels.filter((l) => l.startsWith("lente")).length === 3],

  // ---------- ADR-010: família por papel e escalada do Coder ----------
  ["agentType por família: Planner, Coder e Tester em -sonnet; Architect, Reviewer e Spec-Writer em -opus; Security-SRE em -fable",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON({ needs_spec: true }), spec: PTR("spec-writer"), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => {
      const tipo = (l) => r.calls.find((c) => c.label === l).agentType;
      return r.res.status === "done" && tipo("plan") === "planner-sonnet" && tipo("coder r1") === "coder-sonnet" && tipo("tester") === "tester-sonnet"
        && tipo("lente: reprodução") === "tester-sonnet" && tipo("spec") === "spec-writer-opus" && tipo("design") === "architect-opus"
        && tipo("lente: correção") === "reviewer-opus" && tipo("refutador cego") === "reviewer-opus" && tipo("lente: segurança") === "security-sre-fable"
        && r.calls.every((c) => c.label.startsWith("coder") || c.model === undefined);
    }],

  ["fatia média não sensível: Coder fica em Sonnet (sem model na chamada)",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.calls.find((c) => c.label === "coder r1").model === undefined],

  ["task sensível escala o Coder para Opus",
    { args: { task_id: T, sensitive: true }, answers: {
        recon: RECON({ complexity: "trivial" }), coder: PTR("coder"),
        "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
    (r) => r.res.status === "done" && r.calls.find((c) => c.label === "coder r1").model === "opus"],

  ["migração de dados escala o Coder para Opus",
    { args: { task_id: T }, answers: { recon: RECON({ data_migration: true }), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.calls.find((c) => c.label === "coder r1").model === "opus"],

  ["complexidade complexa escala o Coder para Opus, também na continuação de checkpoint",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "complexa" }), design: PTR("architect"), plan: PTR("planner"), coder: [CP("coder"), PTR("coder")], tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.calls.filter((c) => c.label.startsWith("coder")).every((c) => c.model === "opus")
      && r.calls.filter((c) => c.label.startsWith("coder")).length === 2],

  ["rodada 2 depois de REPROVADO escala o Coder; rodada 1 não",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"),
        review: (n) => (n === 1 ? NOK("reviewer") : OK("reviewer")) } },
    (r) => r.res.status === "done" && r.calls.find((c) => c.label === "coder r1").model === undefined
      && r.calls.find((c) => c.label === "coder r2").model === "opus"],

  // ---------- ADR-009, adendo 2026-10-31: releitura ----------
  ["todo agente recebe a regra de agrupar chamadas e de ler artefato por resumo e seção, com os tetos do perfil",
    { args: { task_id: T, orcamento: { ...ORC, artefatos: { resumo_max_linhas: 40, max_linhas: 200 } } }, answers: { recon: RECON({ complexity: "trivial" }), coder: PTR("coder"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.calls.every((c) => /MESMA resposta/.test(c.prompt) && /## Seções por papel/.test(c.prompt))
      && /até 40 linhas/.test(r.calls[0].prompt) && /200 linhas/.test(r.calls[0].prompt)],

  ["task complexa com grupos: um Coder por grupo, em sequência, e o review lê os coder-gNN.md",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "complexa" }), design: PTR("architect"),
        plan: { ...PTR("planner"), grupos: [{ slug: "api", tasks: ["task-001"], files: ["a.ts"] }, { slug: "ui", tasks: ["task-002"], files: ["b.ts"] }] },
        coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => { const cs = r.calls.filter((c) => c.label.startsWith("coder"));
      const rev = r.calls.find((c) => c.label.startsWith("review"));
      return r.res.status === "done" && cs.map((c) => c.label).join("|") === "coder r1 · g01|coder r1 · g02"
        && /coder-g01\.md/.test(cs[0].prompt) && /SÓ o grupo 01 "api"/.test(cs[0].prompt) && /coder-g01\.md/.test(cs[1].prompt)
        && /coder-g01\.md, .*coder-g02\.md/.test(rev.prompt) && r.calls.find((c) => c.label === "plan").schema.properties.grupos; }],

  ["grupos: Coder de grupo bloqueado para o fluxo antes do grupo seguinte",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "complexa" }), design: PTR("architect"),
        plan: { ...PTR("planner"), grupos: [{ slug: "a", tasks: ["t1"], files: ["a.ts"] }, { slug: "b", tasks: ["t2"], files: ["b.ts"] }] },
        coder: PTR("coder", "blocked"), tester: PTR("tester") } },
    (r) => r.res.status === "blocked" && r.res.em === "coder" && !r.labels.includes("coder r1 · g02")],

  ["grupos: rodada 2 é um Coder só, que consolida o diff em coder.md, e o review volta a ler coder.md",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "complexa" }), design: PTR("architect"),
        plan: { ...PTR("planner"), grupos: [{ slug: "a", tasks: ["t1"], files: ["a.ts"] }, { slug: "b", tasks: ["t2"], files: ["b.ts"] }] },
        coder: PTR("coder"), tester: PTR("tester"), review: (n) => (n === 1 ? NOK("reviewer") : OK("reviewer")) } },
    (r) => { const c2 = r.calls.find((c) => c.label === "coder r2"); const revs = r.calls.filter((c) => c.label.startsWith("review"));
      return r.res.status === "done" && c2 && /TODOS os grupos/.test(c2.prompt)
        && /coder-g02\.md/.test(revs[0].prompt) && /artifacts\/coder\.md\./.test(revs[1].prompt) && !/coder-g0/.test(revs[1].prompt); }],

  ["task não complexa: um Coder, planner sem campo de grupos",
    { args: { task_id: T }, answers: { recon: RECON(), design: PTR("architect"), plan: PTR("planner"), coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.labels.includes("coder r1") && !r.calls.find((c) => c.label === "plan").schema.properties.grupos],

  ["task complexa com um grupo só: um Coder em coder.md",
    { args: { task_id: T }, answers: { recon: RECON({ complexity: "complexa" }), design: PTR("architect"),
        plan: { ...PTR("planner"), grupos: [{ slug: "tudo", tasks: ["t1"], files: ["a.ts"] }] }, coder: PTR("coder"), tester: PTR("tester"), review: OK("reviewer") } },
    (r) => r.res.status === "done" && r.labels.includes("coder r1") && /artifacts\/coder\.md\./.test(r.calls.find((c) => c.label.startsWith("review")).prompt)],

  // ---------- ADR-010, pendência 8: Security-SRE pelo plano, por chamada ----------
  ...[["pro", "opus"], ["team-standard", "opus"], ["enterprise-standard", "opus"],
      ["max", undefined], ["team-premium", undefined], ["enterprise-premium", undefined], ["api", undefined], [undefined, undefined]]
    .map(([plano, modelo]) => [`plano ${plano ?? "ausente"}: lente de segurança ${modelo ? "em Opus por chamada" : "no alias fable"}, demais lentes sem model`,
      { args: { task_id: T, sensitive: true, ...(plano ? { plano } : {}) }, answers: {
          recon: RECON({ complexity: "trivial" }), coder: PTR("coder"),
          "lente: correção": OK("reviewer"), "lente: segurança": OK("security-sre"), "lente: reprodução": OK("tester"), "refutador cego": OK("reviewer") } },
      (r) => r.res.status === "done" && r.calls.find((c) => c.label === "lente: segurança").model === modelo
        && r.calls.find((c) => c.label === "lente: segurança").agentType === "security-sre-fable"
        && r.calls.filter((c) => c.label !== "lente: segurança" && !c.label.startsWith("coder")).every((c) => c.model === undefined)]),
];

let pass = 0;
const failures = [];
for (const [desc, scenario, check] of CASES) {
  const r = await run(scenario);
  let ok = false;
  try { ok = !!check(r); } catch { ok = false; }
  if (ok) pass++;
  else failures.push(`  [falhou] ${desc}\n      status=${r.res && r.res.status} err=${r.err && r.err.message} chamadas=${r.labels.join(", ")}`);
}
console.log(PATH);
console.log(`  passou: ${pass}/${CASES.length}   falhou: ${CASES.length - pass}`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
