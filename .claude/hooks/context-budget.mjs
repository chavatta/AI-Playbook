#!/usr/bin/env node
// PostToolUse/* — orçamento de contexto (docs/ADR-009). NÃO BLOQUEIA: sempre sai com 0, nunca escreve em
// stderr e nunca devolve campo de decisão — não participa de gate. Quando há o que avisar, devolve
// `additionalContext`, que o runtime anexa DEPOIS do resultado da ferramenta (fim do contexto: não quebra
// o prefixo em cache).
//
// Avisa quando:
//   1. um resultado de ferramenta passa de `saida_ferramenta.aviso_resultado_tokens` (disciplina de saída,
//      praticas/12) — e registra o evento para medir adesão;
//   2. um subagente atinge o limiar de checkpoint por tool calls (faixa de complexidade da task) ou por
//      contexto — Reviewer e Security-SRE recebem "escopo excedido" em vez de checkpoint;
//   3. a sessão principal passa de `sessao_orquestrador.contexto_max_tokens` — hora do handoff.
//
// Limiares: bloco JSON "orcamento-contexto" de praticas/00-stack-e-defaults.md (perfil do projeto).
// Sem o bloco, valem os defaults abaixo, que são os mesmos do template.
// Estado (contagem por agente): diretório temporário do sistema. Registro de avisos: .claude/context-budget.jsonl
// (fora do git). Só módulos node:, Node ≥ 18.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  checkpoint: {
    tool_calls_por_faixa: { trivial: 12, simples: 12, media: 20, complexa: 30 },
    faixa_padrao: "media",
    contexto_agente_tokens: 80000,
    lembrete_a_cada_tool_calls: 10,
  },
  sessao_orquestrador: { contexto_max_tokens: 250000 },
  saida_ferramenta: { aviso_resultado_tokens: 8000 },
};

const SEM_CHECKPOINT = /^(reviewer|security-sre)(-|$)/; // gates: estouro = escopo demais, não checkpoint

// Mede só o que o modelo lê do resultado. O tool_response traz campos que não entram no contexto —
// conteúdo e patch de Write/Edit, bashEditDiff do Bash, originalFile — e medi-los dava falso positivo.
const SEM_SAIDA_VISIVEL = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "TodoWrite"]);
const INVISIVEIS = new Set(["structuredPatch", "originalFile", "bashEditDiff", "userModified", "gitDiff", "oldString", "newString", "old_string", "new_string", "replaceAll"]);
export function tamanhoVisivel(ferramenta, resp) {
  if (resp === undefined || resp === null || SEM_SAIDA_VISIVEL.has(ferramenta)) return 0;
  if (typeof resp === "string") return resp.length;
  if (ferramenta === "Bash") return String(resp.stdout ?? "").length + String(resp.stderr ?? "").length;
  if (ferramenta === "Read" && resp.file && typeof resp.file.content === "string") return resp.file.content.length;
  return JSON.stringify(resp, (k, v) => (INVISIVEIS.has(k) ? undefined : v)).length;
}

function done(msgs) {
  if (msgs && msgs.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msgs.join("\n") },
    }));
  }
  process.exit(0);
}

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? merge(base[k], v) : v;
  }
  return out;
}

// Extrai o bloco ```json entre os marcadores orcamento-contexto do perfil do projeto.
export function lerPerfil(texto) {
  const m = /<!--\s*orcamento-contexto:inicio\s*-->[\s\S]*?```json\s*([\s\S]*?)```[\s\S]*?<!--\s*orcamento-contexto:fim\s*-->/.exec(texto);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function config(cwd) {
  const alt = process.env.PLAYBOOK_ORCAMENTO_ARQUIVO; // só para teste: JSON puro
  try {
    if (alt) return merge(DEFAULTS, JSON.parse(readFileSync(alt, "utf8")));
    return merge(DEFAULTS, lerPerfil(readFileSync(join(cwd, "praticas", "00-stack-e-defaults.md"), "utf8")));
  } catch {
    return DEFAULTS;
  }
}

function lerTrecho(path, fim, bytes) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, fim ? size - len : 0);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// Contexto atual = entrada + releitura + escrita de cache da última chamada ao modelo na transcrição.
export function contextoAtual(texto) {
  const linhas = texto.split("\n");
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    if (!l.includes('"usage"')) continue;
    try {
      const u = JSON.parse(l)?.message?.usage;
      if (u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    } catch { /* linha cortada no início do trecho */ }
  }
  return null;
}

// Transcrição do subagente. Agente do Task fica em {sessão}/subagents/agent-{id}.jsonl; agente de Workflow, em
// {sessão}/subagents/workflows/{run}/agent-{id}.jsonl. Sem achar o arquivo, o hook não lia contexto nem faixa e
// só o teto de tool calls da faixa padrão valia (ADR-009, adendo 2026-10-31).
export function transcricaoDoAgente(transcriptPath, sessao, agente) {
  const base = join(dirname(transcriptPath), String(sessao), "subagents");
  const nome = `agent-${agente}.jsonl`;
  if (existsSync(join(base, nome))) return join(base, nome);
  try {
    for (const run of readdirSync(join(base, "workflows"))) {
      const p = join(base, "workflows", run, nome);
      if (existsSync(p)) return p;
    }
  } catch { /* sem workflows */ }
  return null;
}

// Faixa de complexidade da task que o subagente atende: task_id no primeiro prompt → recon/brief.
export function faixaDaTask(primeiroPrompt, cwd) {
  const m = /tasks\/(\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*)\//.exec(primeiroPrompt || "");
  if (!m) return null;
  for (const f of ["artifacts/recon.md", "brief.md"]) {
    try {
      const t = readFileSync(join(cwd, "tasks", m[1], f), "utf8").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const c = /complex(?:idade|ity)\W{0,6}(trivial|simples|media|complexa|epica)/.exec(t);
      if (c) return c[1];
    } catch { /* arquivo ausente: tenta o próximo */ }
  }
  return null;
}

function estado(sessao) {
  const dir = join(tmpdir(), "playbook-context-budget");
  const arq = join(dir, `${String(sessao).replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  let s = {};
  try { s = JSON.parse(readFileSync(arq, "utf8")); } catch { /* primeira chamada */ }
  return { s, salvar: () => { try { mkdirSync(dir, { recursive: true }); writeFileSync(arq, JSON.stringify(s)); } catch { /* sem estado: só perde lembrete */ } } };
}

function registrar(cwd, ev) {
  try {
    const dir = join(cwd, ".claude");
    if (!existsSync(dir)) return;
    appendFileSync(join(dir, "context-budget.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n");
  } catch { /* registro é best-effort */ }
}

function main() {
  let j;
  try { j = JSON.parse(readFileSync(0, "utf8")); } catch { done(); }
  if (!j || typeof j !== "object") done();
  const cwd = j.cwd || process.cwd();
  const cfg = config(cwd);
  const msgs = [];
  const agente = j.agent_id ? String(j.agent_id) : null;
  const tipo = String(j.agent_type || (agente ? "subagente" : "sessao-principal"));

  // 1. tamanho do resultado (~4 bytes por token)
  const tokResultado = Math.round(tamanhoVisivel(j.tool_name, j.tool_response) / 4);
  const limResultado = cfg.saida_ferramenta.aviso_resultado_tokens;
  if (tokResultado > limResultado) {
    msgs.push(`[orçamento de contexto] O resultado de ${j.tool_name} teve ~${tokResultado} tokens (limite ${limResultado}). Siga praticas/12: busque antes de ler, leia por faixa, rode teste/lint no modo quiet e mande saída longa para tasks/{id}/artifacts/, lendo só o trecho relevante.`);
    registrar(cwd, { tipo: "resultado_grande", agente: tipo, agent_id: agente, ferramenta: j.tool_name, tokens: tokResultado, limite: limResultado });
  }

  const { s, salvar } = estado(j.session_id || "sem-sessao");
  const chave = agente || "main";
  const a = (s[chave] ||= { n: 0, avisou_ctx: false, faixa: null, ultimo_lembrete: 0 });
  a.n += 1;

  if (agente) {
    // 2. subagente: checkpoint por tool calls e por contexto
    if (!a.tr && j.transcript_path) a.tr = transcricaoDoAgente(j.transcript_path, j.session_id, agente);
    const transcricao = a.tr || null;
    if (a.faixa === null && transcricao) {
      try { a.faixa = faixaDaTask(lerTrecho(transcricao, false, 65536), cwd) || ""; } catch { a.faixa = ""; }
    }
    const cp = cfg.checkpoint;
    const faixa = a.faixa && cp.tool_calls_por_faixa[a.faixa] !== undefined ? a.faixa : cp.faixa_padrao;
    const limCalls = cp.tool_calls_por_faixa[faixa];
    let ctx = null;
    if (transcricao) { try { ctx = contextoAtual(lerTrecho(transcricao, true, 262144)); } catch { /* sem leitura: só tool calls */ } }
    const passouCalls = limCalls > 0 && a.n >= limCalls && (a.ultimo_lembrete === 0 || a.n - a.ultimo_lembrete >= cp.lembrete_a_cada_tool_calls);
    const passouCtx = ctx !== null && ctx > cp.contexto_agente_tokens && !a.avisou_ctx;
    if (passouCalls || passouCtx) {
      const motivo = passouCtx ? `contexto em ~${ctx} tokens (limite ${cp.contexto_agente_tokens})` : `${a.n} tool calls (limite ${limCalls} na faixa ${faixa})`;
      if (SEM_CHECKPOINT.test(tipo)) {
        msgs.push(`[orçamento de contexto] ${motivo}. Você é gate e não usa checkpoint: conclua o que já tem evidência e, se não couber, devolva o sinal de escopo excedido (ADR-009) para o orquestrador dividir a revisão. Não aprove por falta de tempo.`);
      } else {
        msgs.push(`[orçamento de contexto] ${motivo}. Chegue a um estado consistente (código compilando ou mudança pequena isolada e anotada), grave tasks/{id}/artifacts/{agente}-checkpoint-NN.md pelo modelo de tasks/_TEMPLATE/ e devolva o ponteiro com status: checkpoint (ADR-009).`);
      }
      if (passouCalls) a.ultimo_lembrete = a.n;
      if (passouCtx) a.avisou_ctx = true;
      registrar(cwd, { tipo: "limiar_checkpoint", agente: tipo, agent_id: agente, tool_calls: a.n, contexto: ctx, faixa });
    }
  } else if (j.transcript_path) {
    // 3. sessão principal: troca de sessão
    let ctx = null;
    try { ctx = contextoAtual(lerTrecho(j.transcript_path, true, 262144)); } catch { /* sem leitura */ }
    const lim = cfg.sessao_orquestrador.contexto_max_tokens;
    if (ctx !== null && ctx > lim && (a.ultimo_lembrete === 0 || a.n - a.ultimo_lembrete >= cfg.checkpoint.lembrete_a_cada_tool_calls)) {
      a.ultimo_lembrete = a.n;
      msgs.push(`[orçamento de contexto] A sessão está com ~${ctx} tokens de contexto (limite ${lim}). Se houver task em andamento: espere os agentes da onda devolverem o ponteiro, grave tasks/{id}/handoff/sessao-NN.md pelo modelo e peça ao dev para retomar em sessão nova (/clear e depois /task retomar {id}).`);
      registrar(cwd, { tipo: "limiar_sessao", agente: tipo, contexto: ctx, limite: lim });
    }
  }
  salvar();
  done(msgs);
}

// Importado pela suíte: não executa.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { process.exit(0); }
}
