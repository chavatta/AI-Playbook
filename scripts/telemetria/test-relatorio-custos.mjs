#!/usr/bin/env node
// Suíte do relatório de custos. Sem dependência, sem rede: monta transcrições falsas num diretório temporário.
// Uso: node scripts/telemetria/test-relatorio-custos.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { coletar, analisar, relatorio, lerExecucao, precoDe, ganhoPorPapel, lerLimiares } from "./relatorio-custos.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const precos = JSON.parse(readFileSync(join(AQUI, "precos.json"), "utf8"));
const lim = { razao_cache_alerta: 1.5, fator_excesso_cache: 1.1, saida_implausivel_tokens_por_chamada: 20, saida_implausivel_min_chamadas: 10 };
let ok = 0, falhas = 0;
const caso = (n, fn) => { try { fn(); ok++; console.log(`ok   ${n}`); } catch (e) { falhas++; console.log(`FALHA ${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const perto = (a, b, m) => assert(Math.abs(a - b) < 1e-9, `${m}: ${a} ≠ ${b}`);

const user = (t) => JSON.stringify({ type: "user", message: { role: "user", content: t } });
// Uma chamada = várias linhas com o mesmo id; as primeiras trazem saída parcial.
const chamada = (id, { modelo = "claude-opus-5-5", entrada = 2, w5 = 0, w1h = 0, leitura = 0, saida = 100, partes = 3 } = {}) =>
  Array.from({ length: partes }, (_, i) => JSON.stringify({
    type: "assistant", timestamp: `2026-01-01T00:00:0${i}Z`,
    message: { id, model: modelo, usage: { input_tokens: entrada, cache_creation_input_tokens: w5 + w1h, cache_read_input_tokens: leitura, output_tokens: i === partes - 1 ? saida : 3, cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1h } } },
  }));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rel-"));
  // sessão principal saudável: cada chamada escreve só o delta
  writeFileSync(join(dir, "s1.jsonl"), [user("orquestra"),
    ...chamada("a", { w1h: 10000, leitura: 0 }), ...chamada("b", { w1h: 2000, leitura: 10000 }), ...chamada("c", { w1h: 1000, leitura: 12000 })].join("\n"));
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  // coder: cache quebrado — reescreve tudo a cada chamada
  writeFileSync(join(dir, "s1", "subagents", "agent-x.jsonl"), [user("Leia tasks/2026-01-01_fatia/brief.md"),
    ...chamada("d", { w5: 20000 }), ...chamada("e", { w5: 21000 }), ...chamada("f", { w5: 22000 })].join("\n"));
  writeFileSync(join(dir, "s1", "subagents", "agent-x.meta.json"), JSON.stringify({ agentType: "coder-opus" }));
  // tester: 12 chamadas com saída parcial (1 linha por chamada, saida 3)
  writeFileSync(join(dir, "s1", "subagents", "agent-y.jsonl"), [user("Task 2026-01-01_outra"),
    ...Array.from({ length: 12 }, (_, i) => chamada(`t${i}`, { w5: 100, leitura: 5000 + i * 100, saida: 3, partes: 1 })).flat()].join("\n"));
  writeFileSync(join(dir, "s1", "subagents", "agent-y.meta.json"), JSON.stringify({ agentType: "tester-opus" }));
  return dir;
}

caso("deduplica chamadas por message.id e fica com a maior saída", () => {
  const dir = fixture();
  const e = lerExecucao(join(dir, "s1.jsonl"));
  assert(e.chamadas.length === 3, `3 chamadas, veio ${e.chamadas.length}`);
  assert(e.chamadas.every((c) => c.saida === 100), "saída final, não a parcial");
});

caso("razão de cache saudável ≈ 1 na sessão principal", () => {
  const a = analisar({ papel: "sessao-principal", ...lerExecucao(join(fixture(), "s1.jsonl")) }, precos, lim);
  assert(a.ctxFinal === 2 + 12000 + 1000, `contexto final ${a.ctxFinal}`);
  perto(a.razao, (6 + 13000) / 13002, "razão");
  assert(!a.alertaCache, "sem alerta");
});

caso("cache quebrado: razão, alerta e excesso em dólar", () => {
  const a = analisar({ papel: "coder", ...lerExecucao(join(fixture(), "s1", "subagents", "agent-x.jsonl")) }, precos, lim);
  const esc = 63000, ctx = 22002;
  perto(a.razao, (6 + esc) / ctx, "razão");
  assert(a.alertaCache, "alerta");
  perto(a.excessoTok, esc - ctx * 1.1, "excesso em tokens");
  perto(a.excessoUsd, (esc - ctx * 1.1) * 5 / 1e6, "excesso em dólar no preço de escrita 5m do Opus 5.5");
});

caso("custo decomposto por tipo em dólar, com escrita 5m e 1h em preços diferentes", () => {
  const a = analisar({ papel: "sessao-principal", ...lerExecucao(join(fixture(), "s1.jsonl")) }, precos, lim);
  perto(a.custo.escrita, 13000 * 8 / 1e6, "escrita 1h a $8/MTok");
  perto(a.custo.releitura, 22000 * 0.2 / 1e6, "releitura a $0.20/MTok");
  perto(a.custo.saida, 300 * 20 / 1e6, "saída a $20/MTok");
  perto(a.custo.entrada, 6 * 4 / 1e6, "entrada a $4/MTok");
});

caso("saída implausível marcada, sem corrigir o número", () => {
  const a = analisar({ papel: "tester", ...lerExecucao(join(fixture(), "s1", "subagents", "agent-y.jsonl")) }, precos, lim);
  assert(a.saidaSubestimada && a.tok.saida === 36, `marca e mantém 36, veio ${a.tok.saida}`);
});

caso("filtro por task pelo primeiro prompt", () => {
  const s = coletar(fixture(), { task: "2026-01-01_fatia" });
  assert(s.length === 1 && s[0].execs.length === 1 && s[0].execs[0].papel === "coder", JSON.stringify(s.map((x) => x.execs.map((e) => e.papel))));
});

caso("papel vem do meta.json sem o sufixo de modelo", () => {
  const papeis = coletar(fixture())[0].execs.map((e) => e.papel).sort();
  assert(JSON.stringify(papeis) === JSON.stringify(["coder", "sessao-principal", "tester"]), papeis.join(","));
});

caso("agentes de Workflow (subagents/workflows/**) entram, com o papel da descrição", () => {
  const dir = fixture();
  const wf = join(dir, "s1", "subagents", "workflows", "wf_1");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "agent-w.jsonl"), [user("Leia tasks/2026-01-01_fatia/brief.md"), ...chamada("w1", { w5: 1000 })].join("\n"));
  writeFileSync(join(wf, "agent-w.meta.json"), JSON.stringify({ agentType: "workflow-subagent", description: "FATIA-X:reviewer r1" }));
  writeFileSync(join(wf, "agent-v.jsonl"), [user("Task 2026-01-01_fatia"), ...chamada("v1", { w5: 1000 })].join("\n"));
  writeFileSync(join(wf, "agent-v.meta.json"), JSON.stringify({ agentType: "workflow-subagent", description: "pesquisa livre" }));
  writeFileSync(join(wf, "agent-u.jsonl"), [user("Task 2026-01-01_fatia"), ...chamada("u1", { w5: 1000 })].join("\n"));
  writeFileSync(join(wf, "agent-u.meta.json"), JSON.stringify({ agentType: "workflow-subagent", description: "FATIA-X:lente-segurança r2" }));
  const papeis = coletar(dir)[0].execs.map((e) => e.papel).sort();
  assert(JSON.stringify(papeis) === JSON.stringify(["coder", "reviewer", "security-sre", "sessao-principal", "tester", "workflow-subagent"]), papeis.join(","));
});

caso("preço casa pelo prefixo mais longo", () => {
  assert(precoDe("claude-opus-5-5[1m]", precos).id === "claude-opus-5-5", "opus 5.5 com sufixo");
  assert(precoDe("claude-opus-5", precos).id === "claude-opus-5", "opus 5 não vira 5.5");
  assert(precoDe("claude-haiku-4-5-20251001", precos).id === "claude-haiku-4-5", "haiku com data");
  assert(precoDe("gpt-x", precos) === null, "sem preço");
});

caso("ganho por papel depende do perfil: releitura custa igual em Opus 5.5 e Sonnet 5.5", () => {
  const leitura = { papel: "leitor", chamadas: [{ modelo: "claude-opus-5-5", entrada: 0, escrita: 0, escrita_5m: 0, escrita_1h: 0, releitura: 1e6, saida: 0 }] };
  const escritor = { papel: "escritor", chamadas: [{ modelo: "claude-opus-5-5", entrada: 0, escrita: 0, escrita_5m: 0, escrita_1h: 0, releitura: 0, saida: 1e6 }] };
  const g = ganhoPorPapel([leitura, escritor], precos, "claude-opus-5-5", "claude-sonnet-5-5");
  const por = Object.fromEntries(g.map((x) => [x.papel, x.ganhoPct]));
  perto(por.leitor, 0, "só releitura: ganho 0");
  perto(por.escritor, 50, "só saída: ganho 50%");
});

caso("relatório tem as seções exigidas", () => {
  const md = relatorio(coletar(fixture()), precos, lim, { de: "claude-opus-5-5", para: "claude-sonnet-5-5", titulo: "t" }).markdown;
  for (const s of ["## Custo por tipo de token", "## Por sessão", "## Por execução", "## Cache quebrado", "## Saída subestimada pela transcrição", "## Ganho estimado"]) assert(md.includes(s), `falta ${s}`);
  assert(/Escrita de cache \| \$/.test(md), "custo em dólar");
  assert(!/metade/i.test(md), "não afirma 'pela metade'");
});

caso("limiares lidos do perfil real do playbook", () => {
  const l = lerLimiares(join(AQUI, "..", ".."));
  assert(l.razao_cache_alerta === 1.5 && l.fator_excesso_cache === 1.1, JSON.stringify(l));
});

console.log(`\n${ok}/${ok + falhas}`);
process.exit(falhas ? 1 : 0);
