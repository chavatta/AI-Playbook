// Portal de gestão do playbook. Zero dependências, Node >= 18, somente leitura.
// Uso: node gestao/serve.mjs   ->   http://localhost:4317   (porta: GESTAO_PORT; 0 = livre)
// Escuta só em 127.0.0.1. Lê arquivos do repo e devolve /api/state. Roda fora da sessão do Claude Code.
// Variável de teste: GESTAO_ROOT (raiz do projeto; padrão: a pasta acima de gestao/).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(process.env.GESTAO_ROOT || path.join(AQUI, '..'))
const PORT = process.env.GESTAO_PORT === undefined || process.env.GESTAO_PORT === '' ? 4317 : Number(process.env.GESTAO_PORT)
const HOST = '127.0.0.1'
const JANELA_ATIVA_MS = 30 * 60e3

const rd = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') } catch { return null } }
const ls = (p) => { try { return fs.readdirSync(path.join(ROOT, p)) } catch { return [] } }
const existe = (p) => fs.existsSync(path.join(ROOT, p))
// Lê só o fim do arquivo (spool cresce): evita carregar tudo a cada 3 s.
function cauda(p, bytes = 768 * 1024) {
  try {
    const f = path.join(ROOT, p), tam = fs.statSync(f).size, fd = fs.openSync(f, 'r')
    try {
      const n = Math.min(tam, bytes), buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, tam - n)
      const t = buf.toString('utf8')
      return tam > n ? t.slice(t.indexOf('\n') + 1) : t
    } finally { fs.closeSync(fd) }
  } catch { return null }
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const natural = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })

// ---------- projeto.json (dado do projeto; nasce do template) ----------
const PROJETO_VAZIO = { nome: 'Projeto', atualizado: '', fases: [], decisoes: [], bloqueios: [], aprovacoes: [], pendencias_manuais: [] }

function garantirProjeto() {
  if (existe('gestao/projeto.json')) return
  try {
    const modelo = rd('gestao/projeto.template.json') || JSON.stringify(PROJETO_VAZIO, null, 2) + '\n'
    fs.mkdirSync(path.join(ROOT, 'gestao'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'gestao/projeto.json'), modelo, { flag: 'wx' })
  } catch { /* somente leitura ou corrida: segue com o vazio */ }
}

function projeto() {
  const txt = rd('gestao/projeto.json')
  let p = null, erro = null
  if (txt === null) erro = 'gestao/projeto.json ausente'
  else { try { p = JSON.parse(txt) } catch (e) { erro = 'gestao/projeto.json inválido: ' + e.message } }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {}
  const arr = (v) => Array.isArray(v) ? v : []
  return {
    erro,
    nome: typeof p.nome === 'string' && p.nome ? p.nome : PROJETO_VAZIO.nome,
    atualizado: p.atualizado || '',
    fases: arr(p.fases).filter((f) => f && typeof f === 'object').map((f) => ({ ...f, itens: arr(f.itens).filter((i) => i && typeof i === 'object') })),
    decisoes: arr(p.decisoes).filter((d) => d && typeof d === 'object').map((d) => ({ ...d, opcoes: arr(d.opcoes) })),
    bloqueios: arr(p.bloqueios).filter((b) => b && typeof b === 'object').map((b) => ({ ...b, resolver: arr(b.resolver), arquivos: arr(b.arquivos), depende_de: arr(b.depende_de) })),
    aprovacoes: arr(p.aprovacoes),
    pendencias_manuais: arr(p.pendencias_manuais),
  }
}

// ---------- ADRs ----------
export function parseAdr(arquivo, txt) {
  const base = arquivo.replace(/\.md$/i, '')
  const m = base.match(/^([A-Za-z0-9]+-D\d+|(?:[A-Za-z0-9]+-)?ADR[-_]?\d+(?:-nota-\d+)?|\d{2,5})(?=[-_.]|$)/i)
  const titulo = ((txt.match(/^#\s+(.+)$/m) || [, base])[1]).replace(/^(?:[A-Za-z0-9]+-)?(?:ADR[-_]?|D)?\d+(?:,\s*nota\s*\d+)?\s*[:—–-]\s*/i, '').trim()
  return {
    id: m ? m[1] : base,
    arquivo,
    titulo,
    status: ((txt.match(/\*\*Status:\*\*\s*([^\n]+)/i) || [, '?'])[1]).trim(),
  }
}

function adrs() {
  const lista = [
    ...ls('docs/adr').filter((f) => /\.md$/i.test(f)).map((f) => 'docs/adr/' + f),
    ...ls('docs').filter((f) => /^ADR-.*\.md$/i.test(f)).map((f) => 'docs/' + f),
  ]
  return lista.map((rel) => parseAdr(path.basename(rel), rd(rel) || '')).sort((a, b) => natural(a.arquivo, b.arquivo))
}

// ---------- run-log e tasks ----------
export function parseRunLog(txt) {
  if (!txt) return []
  return txt.split('\n').filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l)).map((l) => {
    const c = l.split('|').map((s) => s.trim()).slice(1, -1)
    return { ts: c[0] || '', agent: c[1] || '', event: c[2] || '', status: c[3] || '', ref: c[4] || '' }
  })
}

function campoBrief(brief, nome) {
  const m = brief.match(new RegExp('\\*\\*' + escRe(nome) + '[^*\\n]*:\\*\\*[ \\t]*([^\\n]*)'))
  return m ? m[1].split(' — ')[0].trim() : ''
}

function tasks() {
  return ls('tasks').filter((d) => d !== '_TEMPLATE' && (existe(`tasks/${d}/brief.md`) || existe(`tasks/${d}/run-log.md`))).sort(natural).map((id) => {
    const brief = rd(`tasks/${id}/brief.md`) || ''
    const log = parseRunLog(rd(`tasks/${id}/run-log.md`))
    const last = log[log.length - 1]
    const done = log.some((e) => e.event === 'done')
    const blocked = !done && !!last && (last.event === 'blocked' || last.status === 'blocked')
    return {
      id,
      objetivo: ((brief.match(/## Objetivo[^\n]*\n+([^\n]+)/) || [, ''])[1]).trim(),
      complexidade: campoBrief(brief, 'Complexidade'),
      sensivel: campoBrief(brief, 'Sensível'),
      estado: done ? 'done' : blocked ? 'blocked' : last ? 'em curso' : 'novo',
      artifacts: ls(`tasks/${id}/artifacts`),
      decisions: existe(`tasks/${id}/decisions.md`),
      log,
    }
  })
}

// ---------- telemetria ----------
// Contrato playbook.telemetry/v1: `agent` é objeto ({name}). A página trabalha com texto; "main" é a sessão, não um subagente.
export function nomeAgente(a) {
  if (a && typeof a === 'object') a = a.name
  if (typeof a !== 'string') return null
  a = a.trim()
  return !a || a === 'main' ? null : a
}

function events(taskIds, cfg = {}) {
  const arquivos = [...taskIds.map((t) => `tasks/${t}/telemetry.jsonl`), '.claude/telemetry-spool.jsonl']
  const vistos = new Set(), out = []
  for (const f of arquivos) {
    const t = cauda(f)
    if (!t) continue
    for (const l of t.split('\n').slice(-1500)) {
      let e; try { e = JSON.parse(l) } catch { continue }
      if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue
      if (e.event_id) { if (vistos.has(e.event_id)) continue; vistos.add(e.event_id) }
      // O envelope traz {name: papel, type: agent_type completo, instance_id}; `name` sozinho ("planner") não casa com .claude/agents ("planner-sonnet").
      e._tipo = (e.agent && typeof e.agent === 'object' && nomeAgente(e.agent.type)) || (e.data && typeof e.data === 'object' && nomeAgente(e.data.agent_type)) || null
      e._inst = (e.agent && typeof e.agent === 'object' && e.agent.instance_id) || (e.data && typeof e.data === 'object' && e.data.agent_id) || null
      e.agent = nomeAgente(e.agent)
      if (e.data && typeof e.data === 'object') for (const k of ['agent', 'agent_type', 'role']) if (k in e.data) e.data[k] = nomeAgente(e.data[k])
      out.push(e)
    }
  }
  return vincularEventos(out.sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(-1500), cfg)
}

// O hook pode emitir o primeiro subagent.start antes de achar a task (task_id ausente) e os eventos seguintes já com
// task_id (task_source sticky), e os tool.* de subagente só com o papel. Aqui o consumidor religa os eventos:
//  - task_id ausente: herda do mesmo agent_id (o stop do mesmo subagente), senão da mesma execução (run_id) ou, em
//    último caso, da sessão, só quando ela só viu uma task. Marca `task_inferido`.
//  - agente: usa o agent_type completo (do envelope, do data ou do agent_id do start); papel solto ("planner") é
//    resolvido para o agente de .claude/agents com esse papel, se for único.
export function vincularEventos(evs, cfg = {}) {
  const porInst = new Map(), porRun = new Map(), porSessao = new Map(), tipoInst = new Map()
  for (const e of evs) {
    if (e._inst && e._tipo) tipoInst.set(e._inst, e._tipo)
    if (!e.task_id) continue
    if (e._inst && !porInst.has(e._inst)) porInst.set(e._inst, e.task_id)
    if (e.run_id && !porRun.has(e.run_id)) porRun.set(e.run_id, e.task_id)
    if (e.session_id) { const s = porSessao.get(e.session_id) || new Set(); s.add(e.task_id); porSessao.set(e.session_id, s) }
  }
  const papel = (n) => n.replace(/-(?:opus|sonnet|fable|haiku)$/, '')
  const nomes = Object.keys(cfg)
  for (const e of evs) {
    if (!e.task_id) {
      const s = e.session_id && porSessao.get(e.session_id)
      const id = (e._inst && porInst.get(e._inst)) || (e.run_id && porRun.get(e.run_id)) || (s && s.size === 1 ? [...s][0] : null)
      if (id) { e.task_id = id; e.task_inferido = true }
    }
    const tipo = e._tipo || (e._inst && tipoInst.get(e._inst)) || null
    if (tipo) { if (e.agent) e.agent = tipo; if (e.data && typeof e.data === 'object') e.data.agent_type = tipo }
    if (e.agent && !cfg[e.agent]) { const c = nomes.filter((n) => papel(n) === e.agent); if (c.length === 1) e.agent = c[0] }
    if (e.data && typeof e.data === 'object') for (const k of ['agent_type', 'agent', 'role']) {
      const v = e.data[k]
      if (typeof v === 'string' && v && !cfg[v]) { const c = nomes.filter((n) => papel(n) === v); if (c.length === 1 && k !== 'role') e.data[k] = c[0] }
    }
    delete e._tipo; delete e._inst
  }
  return evs
}

function agentCfg() {
  const cfg = {}
  for (const f of ls('.claude/agents').filter((x) => x.endsWith('.md'))) {
    const txt = rd('.claude/agents/' + f) || ''
    const fm = (txt.match(/^---\n([\s\S]*?)\n---/) || [, ''])[1]
    const g = (k) => (fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [, ''])[1].trim().replace(/^["']|["']$/g, '')
    cfg[g('name') || f.replace(/\.md$/, '')] = { model: g('model'), effort: g('effort') }
  }
  return cfg
}

function agentes(evs, cfg) {
  const st = {}
  for (const n of Object.keys(cfg)) st[n] = { nome: n, estado: 'ocioso', ultimo: null, execucoes: 0, ferramentas: 0, modelo: cfg[n].model, esforco: cfg[n].effort }
  const now = Date.now()
  for (const e of evs) {
    const a = e.agent || (e.data && (e.data.agent_type || e.data.agent))
    if (!a) continue
    const s = (st[a] ||= { nome: a, estado: 'ocioso', ultimo: null, execucoes: 0, ferramentas: 0, modelo: '', esforco: '' })
    s.ultimo = e.ts
    if (e.type === 'subagent.start') { s.estado = 'ativo'; s.execucoes++ }
    if (e.type === 'subagent.stop') s.estado = 'ocioso'
    if (e.type.startsWith('tool.')) s.ferramentas++
  }
  for (const s of Object.values(st)) if (s.estado === 'ativo' && now - Date.parse(s.ultimo) > JANELA_ATIVA_MS) s.estado = 'ocioso'
  return Object.values(st).sort((a, b) => natural(a.nome, b.nome))
}

// Fluxo dinâmico: um desenho por execução (run_id, senão task_id), na ordem real dos eventos. Nenhuma etapa fixa.
export function fluxos(evs, ts, cfg, agora = Date.now()) {
  const runs = new Map()
  for (const e of evs) {
    const key = e.run_id || e.task_id || e.session_id
    if (!key) continue
    const r = runs.get(key) || { id: key, task: e.task_id || null, passos: [], proximo: null, estado: null, atualizado: e.ts, esforcoSessao: null }
    runs.set(key, r)
    r.atualizado = e.ts
    if (e.task_id) r.task = e.task_id
    const d = e.data && typeof e.data === 'object' ? e.data : {}
    if (e.type === 'session.start' && d.effort) r.esforcoSessao = d.effort
    const nome = e.agent || d.agent_type || d.agent || d.role
    const achar = (n) => r.passos.find((p) => p.agent === n && p.estado === 'ativo') || r.passos.slice().reverse().find((p) => p.agent === n)
    if (e.type === 'subagent.start' && nome) {
      r.passos.push({ agent: nome, estado: 'ativo', inicio: e.ts, ...(d.model_requested ? { solicitado: d.model_requested } : {}) })
      r.proximo = null
    } else if (e.type === 'subagent.stop' && nome) {
      let p = achar(nome); if (!p) r.passos.push((p = { agent: nome }))
      p.estado = d.status === 'completed' || d.status === 'unknown' ? 'concluido' : 'falhou'
      if (d.duration_ms) p.duracao_ms = d.duration_ms
      if (d.model_resolved) p.modelo = d.model_resolved
    } else if (e.type === 'handoff.pointer' && nome) {
      let p = achar(nome); if (!p) r.passos.push((p = { agent: nome }))
      if (d.status === 'blocked') p.estado = 'bloqueado'
      else if (d.status === 'needs_review') p.estado = 'revisao'
      else if (p.estado !== 'ativo') p.estado = 'concluido'
      if (d.model) p.modelo = d.model
      r.proximo = nomeAgente(d.next_agent)
    } else if (e.type === 'run.state' && d.state) r.estado = d.state
    if (e.model) { const p = r.passos.at(-1); if (p && p.estado === 'ativo' && nome === p.agent && !p.modelo) p.modelo = e.model }
  }
  // Sem telemetria da task: reconstrói do run-log (avança por etapa concluída).
  const comTask = new Set([...runs.values()].map((r) => r.task).filter(Boolean))
  for (const t of ts) {
    if (comTask.has(t.id) || runs.has(t.id) || !t.log.length) continue
    const passos = []
    for (const l of t.log) {
      if (!l.agent || /^orchestr/i.test(l.agent)) continue
      let p = passos.find((x) => x.agent === l.agent)
      if (!p) passos.push((p = { agent: l.agent }))
      p.estado = l.event === 'started' ? 'ativo' : l.event === 'blocked' || l.status === 'blocked' ? 'bloqueado' : l.event === 'needs_review' ? 'revisao' : 'concluido'
    }
    runs.set(t.id, { id: t.id, task: t.id, passos, proximo: null, estado: t.estado === 'done' ? 'completed' : t.estado === 'blocked' ? 'blocked' : null, atualizado: t.log.at(-1).ts.replace(' ', 'T'), origem: 'run-log', esforcoSessao: null })
  }
  const lista = [...runs.values()].filter((r) => r.passos.length)
  for (const r of lista) for (const p of r.passos) {
    const c = cfg[p.agent] || {}
    if (p.modelo) p.modelo_origem = 'real'
    else if (c.model) { p.modelo = c.model; p.modelo_origem = 'configurado' }
    else if (p.solicitado) { p.modelo = p.solicitado; p.modelo_origem = 'configurado' }
    else p.modelo_origem = null
    delete p.solicitado
    p.esforco = c.effort || null
  }
  return lista.map((r) => {
    const ativo = r.passos.some((p) => p.estado === 'ativo') || ['running', 'starting', 'waiting_human', 'waiting_bus'].includes(r.estado)
    const recente = agora - Date.parse(r.atualizado) < JANELA_ATIVA_MS
    return { ...r, emExecucao: ativo && (recente || r.origem === 'run-log') }
  }).sort((a, b) => Number(b.emExecucao) - Number(a.emExecucao) || String(b.atualizado).localeCompare(String(a.atualizado))).slice(0, 8)
}

// ---------- tokens e custo ----------
// A lógica de preço mora em scripts/telemetria/relatorio-custos.mjs; aqui só agregamos o --json (cache ~10 s).
let tokCache = { t: 0, linhas: null, pendente: null }
function linhasCustos() {
  if (tokCache.linhas && Date.now() - tokCache.t < 10000) return Promise.resolve(tokCache.linhas)
  if (tokCache.pendente) return tokCache.pendente
  const script = path.join(ROOT, 'scripts/telemetria/relatorio-custos.mjs')
  const fim = (linhas) => { tokCache = { t: Date.now(), linhas, pendente: null }; return linhas }
  if (!fs.existsSync(script)) return Promise.resolve(fim([]))
  tokCache.pendente = new Promise((ok) => {
    execFile(process.execPath, [script, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 8000, maxBuffer: 32e6 }, (err, out) => {
      let linhas = []
      if (!err) { try { const j = JSON.parse(out); if (Array.isArray(j)) linhas = j } catch {} }
      ok(fim(linhas))
    })
  })
  return tokCache.pendente
}

const zero = () => ({ entrada: 0, escrita: 0, releitura: 0, saida: 0, custo: 0, chamadas: 0 })
export function agregarTokens(linhas, evs) {
  const total = zero(), porPapel = {}, porModelo = {}
  const somar = (m, k, l) => {
    const x = (m[k] ||= zero())
    x.entrada += l.tok.entrada || 0; x.escrita += l.tok.escrita || 0; x.releitura += l.tok.releitura || 0; x.saida += l.tok.saida || 0
    x.custo += l.custoTotal || 0; x.chamadas += l.chamadasN || 0
  }
  const uteis = linhas.filter((l) => l && l.tok)
  for (const l of uteis) { somar({ t: total }, 't', l); somar(porPapel, l.papel || '?', l); somar(porModelo, l.modelo || '?', l) }
  const sessoes = uteis.slice(-12).map((l) => ({ id: String(l.sessao || '').slice(0, 8), papel: l.papel, modelo: l.modelo, ...l.tok, custo: l.custoTotal || 0, razao: l.razao, chamadas: l.chamadasN || 0 }))
  const live = {}
  for (const e of evs) {
    if (e.type !== 'usage.report' || !e.data || !e.data.tokens) continue
    const t = e.data.tokens, k = e.agent || e.data.scope || 'sessão'
    const x = (live[k] ||= { entrada: 0, escrita: 0, releitura: 0, saida: 0, n: 0 })
    x.entrada += t.input || 0; x.escrita += t.cache_write || 0; x.releitura += t.cache_read || 0; x.saida += t.output || 0; x.n++
  }
  const ctx = total.entrada + total.escrita + total.releitura
  return { total, cacheHit: ctx ? total.releitura / ctx : 0, porPapel, porModelo, sessoes, linhas: uteis.length, live }
}

// O portal roda fora da sessão do Claude Code e não herda o `env` do settings: lê o settings.local.json.
function telemetria(ev) {
  let url = process.env.PLAYBOOK_TELEMETRY_URL, projetoId = process.env.PLAYBOOK_PROJECT_ID
  let env = {}
  try { env = JSON.parse(rd('.claude/settings.local.json') || '{}').env || {} } catch {}
  url = url || env.PLAYBOOK_TELEMETRY_URL
  projetoId = projetoId || env.PLAYBOOK_PROJECT_ID || null
  const modo = url === 'spool' ? 'spool local' : url ? 'coletor' : ev.length ? 'eventos encontrados' : 'desligada'
  return { configurada: !!url || ev.length > 0, modo, eventos: ev.length, ultimo: ev.length ? ev[ev.length - 1].ts : null, projeto_id: projetoId }
}

async function state() {
  if (process.env.GESTAO_TEST_FALHA) throw new Error(process.env.GESTAO_TEST_FALHA) // só a suíte usa: prova o 500 em JSON
  const t = tasks()
  const cfg = agentCfg()
  const ev = events(t.map((x) => x.id), cfg)
  const linhas = await linhasCustos()
  return {
    gerado: new Date().toISOString(),
    projeto: projeto(),
    adrs: adrs(),
    tasks: t,
    eventos: ev.slice(-500),
    agentes: agentes(ev, cfg),
    fluxos: fluxos(ev, t, cfg),
    tokens: agregarTokens(linhas, ev),
    telemetria: telemetria(ev),
  }
}

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '')
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.writeHead(403).end('forbidden')
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { allow: 'GET, HEAD' }).end()
    const url = req.url.split('?')[0]
    try {
      if (url === '/api/state') {
        const corpo = JSON.stringify(await state())
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(corpo)
      }
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(fs.readFileSync(path.join(AQUI, 'index.html')))
      }
    } catch (e) {
      console.error('erro em ' + url + ':', e)
      if (res.headersSent) return res.end()
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ erro: 'falha ao montar o estado', detalhe: String(e && e.message || e) }))
    }
    res.writeHead(404).end('not found')
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // O portal tem de continuar no ar: erro inesperado só é registrado.
  process.on('uncaughtException', (e) => console.error('uncaughtException:', e))
  process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e))
  garantirProjeto()
  const srv = criarServidor()
  srv.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Porta ${PORT} em uso (já há um portal rodando?). Use GESTAO_PORT.` : e.message); process.exit(1) })
  srv.listen(PORT, HOST, () => console.log(`Portal de gestão: http://localhost:${srv.address().port}`))
}
