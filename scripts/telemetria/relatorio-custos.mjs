#!/usr/bin/env node
// Relatório de custos e de saúde do cache a partir das transcrições do Claude Code (docs/ADR-009, Frente 1).
// Genérico: não conhece projeto, stack nem cliente. Limiares: bloco "orcamento-contexto" de
// praticas/00-stack-e-defaults.md (chave `telemetria`). Preços: scripts/telemetria/precos.json.
//
// Uso:
//   node scripts/telemetria/relatorio-custos.mjs [--transcricoes <dir>] [--sessao <id>] [--task <task_id>]
//        [--desde AAAA-MM-DD] [--comparar <modelo-de>:<modelo-para>] [--json] [--gravar]
//
//   --transcricoes  pasta de transcrições do projeto (padrão: ~/.claude/projects/<cwd com / trocado por ->)
//   --task          só execuções cujo primeiro prompt cita tasks/<task_id>/ ou "Task <task_id>"
//   --gravar        com --task: grava tasks/<task_id>/artifacts/telemetria.md (artefato de telemetria da task)
//   --comparar      par de modelos para o ganho estimado por papel (padrão claude-opus-5-5:claude-sonnet-5-5)
//
// Método (ver ADR-009 → "Como medir"):
//   - Uma chamada ao modelo aparece em VÁRIAS linhas da transcrição (uma por bloco de conteúdo), com o mesmo
//     message.id. Somar linhas multiplica entrada e cache; aqui cada chamada conta uma vez, com o maior
//     output_tokens entre as linhas dela (as primeiras linhas trazem a saída parcial do streaming).
//   - Contexto final = entrada + releitura + escrita da última chamada.
//   - Razão de cache = (entrada + escrita de cache) ÷ contexto final. Saudável ≈ 1.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const TEL_PADRAO = { razao_cache_alerta: 1.5, fator_excesso_cache: 1.1, saida_implausivel_tokens_por_chamada: 20, saida_implausivel_min_chamadas: 10 };

export function lerLimiares(raiz) {
  try {
    const t = readFileSync(join(raiz, "praticas", "00-stack-e-defaults.md"), "utf8");
    const m = /<!--\s*orcamento-contexto:inicio\s*-->[\s\S]*?```json\s*([\s\S]*?)```/.exec(t);
    return { ...TEL_PADRAO, ...(m ? JSON.parse(m[1]).telemetria : {}) };
  } catch {
    return { ...TEL_PADRAO };
  }
}

export function precoDe(modelo, precos) {
  const id = String(modelo || "");
  let melhor = null;
  for (const k of Object.keys(precos.modelos)) if (id.startsWith(k) && (!melhor || k.length > melhor.length)) melhor = k;
  return melhor ? { id: melhor, ...precos.modelos[melhor] } : null;
}

const texto = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text || "").join("\n") : "";

// Lê uma transcrição (.jsonl) e devolve as chamadas deduplicadas por message.id.
export function lerExecucao(arquivo) {
  const porId = new Map();
  let primeiroPrompt = null;
  let ordem = 0;
  for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
    if (!linha.trim()) continue;
    let o;
    try { o = JSON.parse(linha); } catch { continue; }
    if (primeiroPrompt === null && o.type === "user" && o.message) primeiroPrompt = texto(o.message.content);
    const m = o.message;
    if (o.type !== "assistant" || !m || !m.usage || m.model === "<synthetic>") continue;
    const id = m.id || o.requestId || `linha-${ordem}`;
    const u = m.usage;
    const cc = u.cache_creation || {};
    const w = u.cache_creation_input_tokens || 0;
    const w1h = cc.ephemeral_1h_input_tokens ?? 0;
    const w5m = cc.ephemeral_5m_input_tokens ?? (w - w1h);
    const atual = porId.get(id);
    const reg = { ordem: atual ? atual.ordem : ordem++, ts: o.timestamp, modelo: m.model, entrada: u.input_tokens || 0, escrita: w, escrita_5m: w5m, escrita_1h: w1h, releitura: u.cache_read_input_tokens || 0, saida: u.output_tokens || 0 };
    if (!atual || reg.saida >= atual.saida) porId.set(id, reg);
  }
  const chamadas = [...porId.values()].sort((a, b) => a.ordem - b.ordem);
  return { arquivo, primeiroPrompt: primeiroPrompt || "", chamadas };
}

export function custoChamada(c, p) {
  if (!p) return { entrada: 0, escrita: 0, releitura: 0, saida: 0 };
  const M = 1e6;
  return {
    entrada: (c.entrada * p.entrada) / M,
    escrita: (c.escrita_5m * p.escrita_5m + c.escrita_1h * p.escrita_1h) / M,
    releitura: (c.releitura * p.releitura) / M,
    saida: (c.saida * p.saida) / M,
  };
}

const soma = (a, b) => ({ entrada: a.entrada + b.entrada, escrita: a.escrita + b.escrita, releitura: a.releitura + b.releitura, saida: a.saida + b.saida });
const ZERO = { entrada: 0, escrita: 0, releitura: 0, saida: 0 };
const total = (c) => c.entrada + c.escrita + c.releitura + c.saida;

// Métricas de uma execução (sessão principal ou subagente).
export function analisar(exec, precos, lim) {
  const ch = exec.chamadas;
  const tok = ch.reduce((a, c) => ({ entrada: a.entrada + c.entrada, escrita: a.escrita + c.escrita, escrita_5m: a.escrita_5m + c.escrita_5m, escrita_1h: a.escrita_1h + c.escrita_1h, releitura: a.releitura + c.releitura, saida: a.saida + c.saida }),
    { entrada: 0, escrita: 0, escrita_5m: 0, escrita_1h: 0, releitura: 0, saida: 0 });
  const ult = ch[ch.length - 1];
  const ctxFinal = ult ? ult.entrada + ult.releitura + ult.escrita : 0;
  const custo = ch.reduce((a, c) => soma(a, custoChamada(c, precoDe(c.modelo, precos))), ZERO);
  const razao = ctxFinal > 0 ? (tok.entrada + tok.escrita) / ctxFinal : null;
  const modelos = {};
  for (const c of ch) modelos[c.modelo] = (modelos[c.modelo] || 0) + 1;
  const modelo = Object.entries(modelos).sort((a, b) => b[1] - a[1])[0]?.[0] || "?";
  const semPreco = ch.some((c) => !precoDe(c.modelo, precos));
  // preço médio efetivo da escrita desta execução, para o excesso
  const precoEscrita = tok.escrita > 0 ? custo.escrita / tok.escrita : 0;
  const excessoTok = Math.max(0, tok.escrita - ctxFinal * lim.fator_excesso_cache);
  return {
    ...exec, tok, ctxFinal, custo, custoTotal: total(custo), razao, modelo, semPreco,
    chamadasN: ch.length,
    alertaCache: razao !== null && razao > lim.razao_cache_alerta,
    excessoTok, excessoUsd: excessoTok * precoEscrita,
    saidaSubestimada: ch.length > lim.saida_implausivel_min_chamadas && tok.saida / ch.length < lim.saida_implausivel_tokens_por_chamada,
  };
}

const PAPEIS_WORKFLOW = /\b(coder|reviewer|tester|architect|planner|spec-writer|debugger|documenter|devops|data-engineer|ai-engineer)\b/i;

// Papel pelo meta.json do subagente (agentType sem o sufixo de modelo), ou sessão principal.
function papelDe(arquivo) {
  const meta = arquivo.replace(/\.jsonl$/, ".meta.json");
  if (!existsSync(meta)) return basename(dirname(arquivo)) === "subagents" ? "subagente" : "sessao-principal";
  try {
    const m = JSON.parse(readFileSync(meta, "utf8"));
    const t = m.agentType || "subagente";
    // Agente de Workflow: o tipo é genérico; o papel vem da descrição que o script deu (ex.: "FATIA:coder r1").
    if (t === "workflow-subagent") {
      const d = m.description || "";
      if (/segurança|seguranca|\bsecurity\b/i.test(d)) return "security-sre";
      if (/\breview|revis|lente-corre|refutador/i.test(d)) return "reviewer";
      const p = PAPEIS_WORKFLOW.exec(d);
      return p ? p[1].toLowerCase() : t;
    }
    return t.replace(/-(opus|sonnet|haiku|fable|mythos)$/, "");
  } catch { return "subagente"; }
}

function transcricoesDe(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const g of readdirSync(dir)) {
    const p = join(dir, g);
    if (statSync(p).isDirectory()) out.push(...transcricoesDe(p));
    else if (g.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export function coletar(dir, { sessao, task, desde } = {}) {
  const sessoes = [];
  if (!existsSync(dir)) return sessoes;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const id = f.slice(0, -6);
    if (sessao && id !== sessao) continue;
    const principal = join(dir, f);
    if (desde && statSync(principal).mtime < new Date(desde)) continue;
    const execs = [{ papel: "sessao-principal", ...lerExecucao(principal) }];
    const sub = join(dir, id, "subagents");
    // Recursivo: os agentes de Workflow ficam em subagents/workflows/<run>/.
    for (const g of transcricoesDe(sub)) execs.push({ papel: papelDe(g), ...lerExecucao(g) });
    const re = task ? new RegExp(`tasks/${task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/|Task ${task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
    const filtradas = re ? execs.filter((e) => re.test(e.primeiroPrompt)) : execs;
    const comChamadas = filtradas.filter((e) => e.chamadas.length);
    if (comChamadas.length) sessoes.push({ id, execs: comChamadas });
  }
  return sessoes;
}

// Custo das mesmas contagens de tokens no modelo alternativo. Estimativa de 1ª ordem: o modelo alternativo
// não produziria as mesmas contagens (mais ou menos turnos, retrabalho) — o número serve para dizer ONDE
// o ganho existe no perfil de tokens, não para prometer economia.
export function ganhoPorPapel(execs, precos, de, para) {
  const pPara = precoDe(para, precos);
  const por = {};
  for (const e of execs) {
    for (const c of e.chamadas) {
      const p = precoDe(c.modelo, precos);
      if (!p || !pPara || p.id !== precoDe(de, precos)?.id) continue;
      const g = (por[e.papel] ||= { atual: 0, alternativo: 0, releitura: 0 });
      const a = custoChamada(c, p), b = custoChamada(c, pPara);
      g.atual += total(a); g.alternativo += total(b); g.releitura += a.releitura;
    }
  }
  return Object.entries(por).map(([papel, g]) => ({ papel, ...g, ganhoPct: g.atual > 0 ? (1 - g.alternativo / g.atual) * 100 : 0, releituraPct: g.atual > 0 ? (g.releitura / g.atual) * 100 : 0 }))
    .sort((a, b) => b.atual - a.atual);
}

const usd = (v) => `$${v.toFixed(v >= 100 ? 0 : 2)}`;
const k = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
const pct = (a, b) => b > 0 ? `${Math.round((a / b) * 100)}%` : "-";

export function relatorio(sessoes, precos, lim, { de, para, titulo }) {
  const execs = sessoes.flatMap((s) => s.execs.map((e) => ({ ...analisar(e, precos, lim), sessao: s.id })));
  const custoTot = execs.reduce((a, e) => soma(a, e.custo), ZERO);
  const T = total(custoTot);
  const L = [];
  L.push(`# ${titulo}`, "");
  L.push(`Custo equivalente de API (preços de \`scripts/telemetria/precos.json\`). ${execs.length} execução(ões) em ${sessoes.length} sessão(ões). Limiar de razão de cache: ${lim.razao_cache_alerta}.`, "");
  L.push("## Custo por tipo de token", "", "| Tipo | Custo | % |", "|---|---:|---:|");
  for (const [n, v] of [["Entrada sem cache", custoTot.entrada], ["Escrita de cache", custoTot.escrita], ["Releitura de cache", custoTot.releitura], ["Saída", custoTot.saida]]) L.push(`| ${n} | ${usd(v)} | ${pct(v, T)} |`);
  L.push(`| **Total** | **${usd(T)}** | |`, "");

  L.push("## Por sessão", "", "| Sessão | Execuções | Contexto final (soma) | Razão de cache | Entrada | Escrita | Releitura | Saída | Total |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of sessoes) {
    const es = execs.filter((e) => e.sessao === s.id);
    const ctx = es.reduce((a, e) => a + e.ctxFinal, 0);
    const iw = es.reduce((a, e) => a + e.tok.entrada + e.tok.escrita, 0);
    const c = es.reduce((a, e) => soma(a, e.custo), ZERO);
    const r = ctx ? iw / ctx : null;
    L.push(`| \`${s.id.slice(0, 8)}\` | ${es.length} | ${k(ctx)} | ${r === null ? "-" : r.toFixed(2)}${r !== null && r > lim.razao_cache_alerta ? " ⚠" : ""} | ${usd(c.entrada)} | ${usd(c.escrita)} | ${usd(c.releitura)} | ${usd(c.saida)} | ${usd(total(c))} |`);
  }
  L.push("");

  L.push("## Por execução", "", "| Sessão | Papel | Modelo | Chamadas | Contexto final | Razão de cache | Escrita | Releitura | Saída | Total | Marcas |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const e of [...execs].sort((a, b) => b.custoTotal - a.custoTotal)) {
    const marcas = [e.alertaCache && "cache quebrado", e.saidaSubestimada && "saída subestimada pela transcrição", e.semPreco && "modelo sem preço"].filter(Boolean).join("; ");
    L.push(`| \`${e.sessao.slice(0, 8)}\` | ${e.papel} | ${e.modelo} | ${e.chamadasN} | ${k(e.ctxFinal)} | ${e.razao === null ? "-" : e.razao.toFixed(2)}${e.alertaCache ? " ⚠" : ""} | ${usd(e.custo.escrita)} | ${usd(e.custo.releitura)} | ${usd(e.custo.saida)} | ${usd(e.custoTotal)} | ${marcas} |`);
  }
  L.push("");

  const quebradas = execs.filter((e) => e.alertaCache).sort((a, b) => b.excessoUsd - a.excessoUsd);
  L.push("## Cache quebrado", "");
  if (!quebradas.length) L.push(`Nenhuma execução acima de ${lim.razao_cache_alerta}.`, "");
  else {
    L.push(`Execuções com razão de cache acima de ${lim.razao_cache_alerta}, pelo custo em excesso = (escrita − contexto final × ${lim.fator_excesso_cache}) × preço de escrita do modelo.`, "", "| Sessão | Papel | Modelo | Razão | Escrita | Contexto final | Excesso (tokens) | Excesso ($) |", "|---|---|---|---:|---:|---:|---:|---:|");
    for (const e of quebradas) L.push(`| \`${e.sessao.slice(0, 8)}\` | ${e.papel} | ${e.modelo} | ${e.razao.toFixed(2)} | ${k(e.tok.escrita)} | ${k(e.ctxFinal)} | ${k(Math.round(e.excessoTok))} | ${usd(e.excessoUsd)} |`);
    L.push(`| | | | | | | **Total** | **${usd(quebradas.reduce((a, e) => a + e.excessoUsd, 0))}** |`, "");
  }

  const sub = execs.filter((e) => e.saidaSubestimada);
  if (sub.length) {
    L.push("## Saída subestimada pela transcrição", "", `Média abaixo de ${lim.saida_implausivel_tokens_por_chamada} tokens de saída por chamada em execução com mais de ${lim.saida_implausivel_min_chamadas} chamadas. O número não foi corrigido: a transcrição não registrou a saída final dessas chamadas. Trate o custo de saída delas como piso.`, "");
    for (const e of sub) L.push(`- \`${e.sessao.slice(0, 8)}\` · ${e.papel} · ${e.chamadasN} chamadas · ${e.tok.saida} tokens de saída`);
    L.push("");
  }

  const ganhos = ganhoPorPapel(execs, precos, de, para);
  L.push(`## Ganho estimado de trocar ${de} por ${para}, por papel`, "");
  if (!ganhos.length) L.push(`Nenhuma chamada em ${de} no recorte.`, "");
  else {
    L.push("Mesmas contagens de tokens repreçadas. Não é promessa: outro modelo produz outro número de turnos e de retrabalho, e a troca de modelo de um agente é decisão de ADR (ADR-001), não deste relatório. A releitura de cache pesa diferente em cada papel, e é por isso que o ganho não é uma porcentagem fixa.", "",
      "| Papel | Custo atual | Custo repreçado | Ganho | Releitura no custo atual |", "|---|---:|---:|---:|---:|");
    for (const g of ganhos) L.push(`| ${g.papel} | ${usd(g.atual)} | ${usd(g.alternativo)} | ${g.ganhoPct.toFixed(0)}% | ${g.releituraPct.toFixed(0)}% |`);
    L.push("");
  }
  return { markdown: L.join("\n"), execs, custoTot };
}

// ---------- CLI ----------
function arg(n, def) { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : def; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = process.cwd();
  const dir = arg("--transcricoes", join(homedir(), ".claude", "projects", raiz.replace(/[^A-Za-z0-9]/g, "-")));
  const task = arg("--task");
  const [de, para] = arg("--comparar", "claude-opus-5-5:claude-sonnet-5-5").split(":");
  const precos = JSON.parse(readFileSync(join(AQUI, "precos.json"), "utf8"));
  const lim = lerLimiares(raiz);
  const sessoes = coletar(dir, { sessao: arg("--sessao"), task, desde: arg("--desde") });
  const r = relatorio(sessoes, precos, lim, { de, para, titulo: task ? `Telemetria de custo — ${task}` : "Relatório de custos" });
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(r.execs.map(({ chamadas, primeiroPrompt, ...e }) => e), null, 2) + "\n");
  } else {
    process.stdout.write(r.markdown + "\n");
  }
  if (process.argv.includes("--gravar")) {
    if (!task) { console.error("--gravar exige --task"); process.exit(2); }
    const destino = join(raiz, "tasks", task, "artifacts");
    mkdirSync(destino, { recursive: true });
    writeFileSync(join(destino, "telemetria.md"), r.markdown + "\n");
    console.error(`gravado: tasks/${task}/artifacts/telemetria.md`);
  }
}
