/**
 * Suíte do emissor de telemetria do playbook: as garantias de `docs/telemetria/README.md` ("Emissor" e "Spool local")
 * e do ADR-008 §3 e §4 (nunca bloqueia, prazo, disjuntor, drenagem sem perda nem duplicata, spool fora do projeto).
 *
 *   node test-telemetry-emit.mjs <caminho-do-telemetry-emit.mjs>
 *
 * Script Node sem dependência (convenção do playbook): sobe um coletor falso em 127.0.0.1, roda o emissor real como
 * processo em projetos temporários e confere o comportamento observável. Não usa rede externa nem o HOME do usuário.
 * Sai com 0 se tudo passar e 1 se algo falhar; a saída é TAP.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { cpus, loadavg, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const emitterArg = process.argv[2]
if (emitterArg === undefined) {
  process.stderr.write('uso: node test-telemetry-emit.mjs <caminho-do-telemetry-emit.mjs>\n')
  process.exit(2)
}
const EMITTER = resolve(emitterArg)
const TASK = '2026-09-24_suite'
const BUDGET_MS = 1500
/** De fora, criar e encerrar o processo custa mais sob carga; o prazo estrito vale no relógio do emissor. */
const SPAWN_SLACK_MS = 600
/**
 * Carregado antes do emissor (`--import`, Node ≥ 18.18): na saída, escreve no fd 3 o relógio do próprio processo
 * (`performance.now()`, ms desde `performance.timeOrigin`), que é o t = 0 do orçamento de tempo. Não muda o
 * emissor; só expõe a medida que ele mesmo usa para o prazo.
 */
const EXIT_CLOCK = `data:text/javascript,${encodeURIComponent(
  "import{writeSync}from'node:fs';process.on('exit',()=>{try{writeSync(3,String(performance.now()))}catch{}})",
)}`
const EVENT_TYPES = new Set([
  'session.start',
  'session.end',
  'prompt.submit',
  'tool.pre',
  'tool.post',
  'tool.fail',
  'subagent.start',
  'subagent.stop',
  'handoff.pointer',
  'permission.request',
  'permission.resolved',
  'notification',
  'usage.report',
  'limit.hit',
  'compact',
  'error',
])
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// ---------------------------------------------------------------------------------------------------------------------
// Infra

const cleanups = []

function workspace() {
  const base = mkdtempSync(join(tmpdir(), 'telemetry-suite-'))
  cleanups.push(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'projeto')
  mkdirSync(join(root, '.git', 'info'), { recursive: true })
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:exemplo/projeto.git\n')
  writeFileSync(join(root, '.git', 'info', 'exclude'), '# original\n')
  mkdirSync(join(root, '.claude'))
  mkdirSync(join(root, 'tasks', TASK), { recursive: true })
  writeFileSync(join(root, 'tasks', TASK, 'brief.md'), '# brief\n')
  const env = { home: join(base, 'home'), tmp: join(base, 'tmp'), cache: join(base, 'cache') }
  for (const dir of Object.values(env)) mkdirSync(dir)
  return {
    root,
    dirs: env,
    taskSpool: join(root, 'tasks', TASK, 'telemetry.jsonl'),
    env: (extra = {}) => ({
      PATH: process.env.PATH,
      HOME: env.home,
      TMPDIR: env.tmp,
      XDG_CACHE_HOME: env.cache,
      PLAYBOOK_TASK_ID: TASK,
      ...extra,
    }),
  }
}

let serial = 0
function toolPayload(root, extra = {}) {
  serial++
  return {
    session_id: 'suite-session',
    cwd: root,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: `echo ${serial}`, description: 'suite' },
    tool_use_id: `toolu_suite_${serial}`,
    ...extra,
  }
}

function runEmitter(env, payload, { stdin = 'close', args = [], cwd = tmpdir() } = {}) {
  // Serializado antes do spawn, como no helper do Vitest: serializar 300 mil chaves depois do spawn, sob carga, atrasava
  // o primeiro byte além dos 300 ms que o emissor espera pelo payload, e o cenário media a suíte em vez do emissor.
  const text = JSON.stringify(payload)
  return new Promise((done) => {
    const started = performance.now()
    const child = spawn(
      process.execPath,
      ['--no-warnings', `--import=${EXIT_CLOCK}`, EMITTER, '--runtime=claude-code', ...args],
      {
        env,
        cwd,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let clock = ''
    child.stdio[3].on('data', (chunk) => {
      clock += chunk
    })
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    // Teto de segurança: um emissor travado é morto (código null) e o cenário falha, em vez de pendurar a suíte.
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.stdin.on('error', () => undefined)
    if (stdin === 'close') child.stdin.end(text)
    child.on('close', (code) => {
      clearTimeout(killer)
      child.stdin.destroy()
      const internal = Number.parseFloat(clock)
      done({
        code,
        stdout,
        stderr,
        elapsedMs: performance.now() - started,
        internalMs: Number.isFinite(internal) ? internal : null,
      })
    })
  })
}

async function startCollector(mode = { kind: 'accept' }) {
  const collector = { url: '', bodies: [], stored: new Map(), receipts: new Map(), mode }
  const server = createHttpServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      collector.bodies.push(body)
      if (collector.mode.kind === 'status') {
        res.writeHead(collector.mode.status, { 'content-type': 'application/json' })
        res.end('{"code":"suite"}')
        return
      }
      const parsed = JSON.parse(body)
      const events = Array.isArray(parsed) ? parsed : [parsed]
      let accepted = 0
      let duplicates = 0
      for (const event of events) {
        collector.receipts.set(event.event_id, (collector.receipts.get(event.event_id) ?? 0) + 1)
        if (collector.stored.has(event.event_id)) duplicates++
        else {
          collector.stored.set(event.event_id, event)
          accepted++
        }
      }
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ accepted, duplicates, rejected: [] }))
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  collector.url = `http://127.0.0.1:${server.address().port}/v1/events`
  cleanups.push(
    () =>
      new Promise((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  )
  return collector
}

async function startBlackhole() {
  const sockets = []
  const server = createTcpServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => undefined)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  cleanups.push(
    () =>
      new Promise((done) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => done())
      }),
  )
  return `http://127.0.0.1:${server.address().port}/v1/events`
}

async function refusedUrl() {
  const server = createTcpServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  await new Promise((done) => server.close(() => done()))
  return `http://127.0.0.1:${port}/v1/events`
}

function readJsonl(path) {
  let content = ''
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  assert(content === '' || content.endsWith('\n'), `${path}: última linha sem \\n`)
  return content
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Load de 1, 5 e 15 min, para o diagnóstico de falha: prazo ou contagem sob CPU saturada se leem de outro jeito. */
function loadAverage() {
  return loadavg()
    .map((value) => value.toFixed(2))
    .join(' ')
}

/** Prazo estrito no relógio do emissor; de fora, só com a folga de criar e encerrar o processo. */
function assertWithinBudget(result, label) {
  // O load entra no diagnóstico de falha: um prazo estourado com a CPU saturada se lê de outro jeito.
  const load = `load average ${loadAverage()}`
  assert(result.internalMs !== null, `${label}: sem relógio interno (o processo não passou pelo exit); ${load}`)
  assert(result.internalMs <= BUDGET_MS, `${label}: ${Math.round(result.internalMs)} ms no relógio do emissor; ${load}`)
  assert(
    result.elapsedMs <= BUDGET_MS + SPAWN_SLACK_MS,
    `${label}: ${Math.round(result.elapsedMs)} ms de fora; ${load}`,
  )
}

const isDeadlineLine = (line) => line?.type === 'error' && line.data?.code === 'deadline_before_payload'

/**
 * Diagnóstico das contagens de linhas: tipos, perdas rastreadas (`deadline_before_payload`, D1: a parada interna chegou
 * antes do payload) e o load. Uma falha com rastro se lê como saturação da máquina, não como perda silenciosa.
 */
function spoolNote(lines) {
  const types = lines.map((line) => (isDeadlineLine(line) ? 'deadline_before_payload' : line.type))
  const tracked = lines.filter(isDeadlineLine).length
  return `linhas [${types.join(', ')}]; ${tracked} perda(s) rastreada(s); load average ${loadAverage()} (${cpus().length} CPUs)`
}

/** Linhas em qualquer spool fora o da task: `.claude/` e cache de último recurso. */
function strayLines(ws) {
  const stray = {}
  const count = (path) => {
    let lines = 0
    try {
      lines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '').length
    } catch {
      return
    }
    if (lines > 0) stray[path] = lines
  }
  count(join(ws.root, '.claude', 'telemetry-spool.jsonl'))
  const cacheDir = join(ws.dirs.cache, 'playbook-telemetry')
  let names = []
  try {
    names = readdirSync(cacheDir)
  } catch {
    return stray
  }
  for (const name of names) if (name.includes('.jsonl')) count(join(cacheDir, name))
  return stray
}

/** Eventos ainda no spool da task (base e `.draining-*`) que o coletor não recebeu, para o diagnóstico da drenagem. */
function pendingIds(ws, received) {
  const dir = join(ws.root, 'tasks', TASK)
  const pending = []
  for (const name of readdirSync(dir)) {
    if (name !== 'telemetry.jsonl' && !/^telemetry\.jsonl\.draining-[0-9A-Z]+$/.test(name)) continue
    for (const raw of readFileSync(join(dir, name), 'utf8').split('\n')) {
      try {
        const id = String(JSON.parse(raw).event_id)
        if (!received.has(id)) pending.push(`${name}:${id}`)
      } catch {
        // linha parcial ou vazia: fora da conta
      }
    }
  }
  return pending
}

function assertSilentSuccess(result, label) {
  assert(result.code === 0, `${label}: código de saída ${result.code}`)
  assert(result.stdout === '', `${label}: stdout não vazio: ${JSON.stringify(result.stdout)}`)
  assert(result.stderr === '', `${label}: stderr não vazio: ${JSON.stringify(result.stderr)}`)
}

function decodeUlidTime(id) {
  let time = 0
  for (const char of id.slice(0, 10)) time = time * 32 + CROCKFORD.indexOf(char)
  return time
}

function assertEnvelope(event) {
  assert(event.schema === 'playbook.telemetry/v1', `schema: ${event.schema}`)
  assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(event.event_id), `event_id: ${event.event_id}`)
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.ts), `ts: ${event.ts}`)
  const drift = decodeUlidTime(event.event_id) - Date.parse(event.ts)
  assert(drift >= 0 && drift <= 1, `tempo do event_id difere de ts em ${drift} ms`)
  assert(EVENT_TYPES.has(event.type), `type: ${event.type}`)
  assert(event.source?.kind === 'hook', 'source.kind')
  assert(typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data), 'data')
  assert(Buffer.byteLength(JSON.stringify(event)) <= 64 * 1024, 'evento > 64 KiB')
}

async function times(count, fn) {
  return Promise.all(Array.from({ length: count }, (_, index) => fn(index)))
}

// ---------------------------------------------------------------------------------------------------------------------
// Cenários

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('URL ausente: no-op com exit 0 e stdout vazio, sem esperar o stdin', async () => {
  const ws = workspace()
  const result = await runEmitter(ws.env(), null, { stdin: 'open' })
  assertSilentSuccess(result, 'no-op')
  assertWithinBudget(result, 'no-op')
  assert(readJsonl(ws.taskSpool).length === 0, 'no-op gravou spool')
})

test('coletor em buraco negro: termina em ≤ 1,5 s com exit 0 e stdout vazio; o evento vai ao spool', async () => {
  const ws = workspace()
  const url = await startBlackhole()
  const result = await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: url }), toolPayload(ws.root))
  assertSilentSuccess(result, 'buraco negro')
  assertWithinBudget(result, 'buraco negro')
  const lines = readJsonl(ws.taskSpool)
  assert(lines.length === 1 && lines[0].type === 'tool.pre', `spool: ${lines.length} linhas`)
})

for (const scenario of ['recusada', '500', '401']) {
  test(`conexão ${scenario === 'recusada' ? 'recusada' : `com ${scenario}`}: spool com linhas JSON completas`, async () => {
    const ws = workspace()
    let url
    if (scenario === 'recusada') url = await refusedUrl()
    else url = (await startCollector({ kind: 'status', status: Number(scenario) })).url
    for (let i = 0; i < 3; i++) {
      assertSilentSuccess(await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: url }), toolPayload(ws.root)), scenario)
    }
    const lines = readJsonl(ws.taskSpool)
    assert(lines.length === 3, `esperava 3 linhas, veio ${lines.length}`)
    for (const line of lines) assertEnvelope(line)
  })
}

test('disjuntor: depois de 503 a invocação seguinte não chama o coletor', async () => {
  const ws = workspace()
  const collector = await startCollector({ kind: 'status', status: 503 })
  const env = ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url })
  assertSilentSuccess(await runEmitter(env, toolPayload(ws.root)), 'primeira')
  assertSilentSuccess(await runEmitter(env, toolPayload(ws.root)), 'segunda')
  assert(collector.bodies.length === 1, `o coletor recebeu ${collector.bodies.length} chamadas`)
  assert(readJsonl(ws.taskSpool).length === 2, 'os dois eventos deviam estar no spool')
})

test('coletor volta: a drenagem entrega cada evento do período exatamente uma vez', async () => {
  const ws = workspace()
  const down = await refusedUrl()
  for (let i = 0; i < 20; i++) await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: down }), toolPayload(ws.root))
  const spooled = readJsonl(ws.taskSpool).map((event) => event.event_id)
  assert(spooled.length === 20, `spool com ${spooled.length}`)
  const collector = await startCollector()
  assertSilentSuccess(
    await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url }), toolPayload(ws.root)),
    'volta',
  )
  for (const id of spooled) assert(collector.stored.has(id), `evento ${id} não chegou`)
  assert(collector.stored.size === 21, `o coletor tem ${collector.stored.size} eventos`)
  assert(
    [...collector.receipts.values()].every((n) => n === 1),
    'algum evento chegou mais de uma vez',
  )
  const replay = collector.bodies.filter((body) => JSON.parse(body).length === 20)
  assert(replay.length === 1, 'a drenagem devia mandar um lote com os 20')
})

test('50 processos concorrentes gravando e drenando: nenhuma perda silenciosa e nenhuma duplicata', async () => {
  const ws = workspace()
  // cwd = raiz do projeto, como o runtime roda o hook: o rastro deadline_before_payload do D1 (gravado pela raiz do cwd
  // do processo, sem payload) cai no mesmo spool da task que o evento normal.
  const run = (env) => runEmitter(env, toolPayload(ws.root), { cwd: ws.root })
  const down = await refusedUrl()
  const writers = await times(50, () => run(ws.env({ PLAYBOOK_TELEMETRY_URL: down })))
  for (const result of writers) assertSilentSuccess(result, 'gravador')
  // Cada gravador deixa exatamente uma linha no spool da task: o tool.pre ou o rastro deadline_before_payload (perda
  // rastreada, aceita pelo D1). Nenhuma linha em outro spool e nenhuma duplicata: o que falta é perda silenciosa.
  const spooled = readJsonl(ws.taskSpool)
  const note = spoolNote(spooled)
  const stray = strayLines(ws)
  assert(Object.keys(stray).length === 0, `linhas fora do spool da task: ${JSON.stringify(stray)}; ${note}`)
  assert(spooled.length === 50, `perda silenciosa: ${50 - spooled.length} de 50; ${note}`)
  const foreign = spooled.filter((line) => line.type !== 'tool.pre' && !isDeadlineLine(line))
  assert(foreign.length === 0, `linha inesperada no spool: ${JSON.stringify(foreign[0]?.data)}; ${note}`)
  assert(new Set(spooled.map((line) => line.event_id)).size === 50, `event_id duplicado no spool; ${note}`)
  const toolUses = spooled.filter((line) => line.type === 'tool.pre').map((line) => line.data?.tool_use_id)
  assert(new Set(toolUses).size === toolUses.length, `tool.pre duplicado no spool; ${note}`)
  if (spooled.some(isDeadlineLine)) process.stdout.write(`# 50 gravadores: ${note}\n`)

  const collector = await startCollector()
  const env = ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url })
  const drainers = await times(50, () => run(env))
  for (const result of drainers) assertSilentSuccess(result, 'drenador')
  // Com a máquina saturada pelos 100 processos, parte dos eventos ao vivo vai ao spool (sem tempo para rede) e, se o
  // coletor demorou, o disjuntor pode ter aberto (janelas de 15 s, 30 s, 60 s): as invocações seguintes drenam até
  // esvaziar. A paciência é por prazo (três janelas seguidas e folga), não por número de rodadas.
  let extra = 0
  const expected = () => 100 + extra
  const patience = performance.now() + 150_000
  while (collector.stored.size < expected() && performance.now() < patience) {
    assertSilentSuccess(await run(env), 'drenagem final')
    extra++
    if (collector.stored.size < expected()) await new Promise((done) => setTimeout(done, 1000))
  }
  const drainNote = () =>
    `${collector.stored.size} no coletor, esperava ${expected()} (${extra} rodadas de drenagem); pendentes no spool da ` +
    `task: [${pendingIds(ws, collector.stored).join(', ')}]; em outro spool: ${JSON.stringify(strayLines(ws))}; ` +
    `load average ${loadAverage()} (${cpus().length} CPUs)`
  for (const event of spooled)
    assert(collector.stored.has(event.event_id), `perdido: ${event.event_id}; ${drainNote()}`)
  assert(collector.stored.size === expected(), `o coletor gravou menos ou mais que o esperado: ${drainNote()}`)
  // Reenvio (resposta perdida no prazo) é permitido e absorvido pelo dedupe por event_id; gravação dupla não.
  const resent = [...collector.receipts.values()].filter((n) => n > 1).length
  process.stdout.write(`# 50 concorrentes: ${collector.stored.size} gravados uma vez; ${resent} reenvios absorvidos\n`)
})

test('segredo no payload: nada sobra no POST nem no spool', async () => {
  const ws = workspace()
  const secrets = [
    [
      'sk-',
      'ant-api03-',
      'aZ9',
      'Qw3rTy8uIoP1aSdFgH2jKlZx5cVbNm7QwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpAsDfGhJkLzXcVb',
    ].join(''),
    ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join(''),
    ['AK', 'IA', 'QWERTYUIOPASDFGH'].join(''),
    [
      'ey',
      'J',
      'hbGciOiJIUzI1NiJ9abcdef',
      '.',
      'ey',
      'J',
      'zdWIiOiIxMjM0NTY3ODkwIn0abcdefgh',
      '.',
      'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c',
    ].join(''),
    ['ch', 'h_h_', 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo'].join(''),
  ]
  const token = ['ch', 'h_h_', 'dG9rZW5kb2hvc3RwYXJhb3Rlc3RlZGFzdWl0ZTEyMzQ'].join('')
  const payload = toolPayload(ws.root, {
    tool_input: {
      command: `curl -H "Authorization: Bearer ${secrets[0]}" "https://x.test/?t=${secrets[1]}" ${secrets.join(' ')}`,
    },
  })
  const collector = await startCollector()
  assertSilentSuccess(
    await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url, PLAYBOOK_TELEMETRY_TOKEN: token }), payload),
    'POST',
  )
  const down = await refusedUrl()
  assertSilentSuccess(
    await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: down, PLAYBOOK_TELEMETRY_TOKEN: token }), payload),
    'spool',
  )
  const everything = [...collector.bodies, readFileSync(ws.taskSpool, 'utf8')].join('\n')
  for (const secret of [...secrets, token])
    assert(!everything.includes(secret), `segredo vazou: ${secret.slice(0, 6)}…`)
  assert(everything.includes('[REDACTED:'), 'a redação devia deixar marcadores')
})

test('modo só-spool (PLAYBOOK_TELEMETRY_URL=spool): grava sem rede e sem tocar .git/info/exclude', async () => {
  const ws = workspace()
  const exclude = readFileSync(join(ws.root, '.git', 'info', 'exclude'), 'utf8')
  assertSilentSuccess(await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: 'spool' }), toolPayload(ws.root)), 'spool')
  const lines = readJsonl(ws.taskSpool)
  assert(lines.length === 1, 'spool vazio')
  assertEnvelope(lines[0])
  assert(readFileSync(join(ws.root, '.git', 'info', 'exclude'), 'utf8') === exclude, '.git/info/exclude mudou')
  const entries = readdirSync(join(ws.root, 'tasks', TASK)).sort()
  assert(JSON.stringify(entries) === JSON.stringify(['brief.md', 'telemetry.jsonl']), `arquivos na task: ${entries}`)
})

test('spool externo (PLAYBOOK_TELEMETRY_SPOOL_DIR + PLAYBOOK_RUN_ID): nada no worktree, válido ou não', async () => {
  const runId = 'run_01J8Z3NDEKTSV4RRFFQ69G5FAV'
  // [rótulo, diretório a partir do workspace, grava no spool externo?]; os demais caem no cache do usuário.
  const cases = [
    ['absoluto', (ws) => join(ws.dirs.home, 'spool-externo'), true],
    ['relativo', () => 'spool-externo', false],
    ['raiz do projeto', (ws) => ws.root, false],
    ['<raiz>/.claude', (ws) => join(ws.root, '.claude'), false],
    ['<fora>/../projeto', (ws) => `${ws.dirs.home}/../projeto`, false],
  ]
  for (const [label, dirOf, external] of cases) {
    const ws = workspace()
    const spoolDir = dirOf(ws)
    const tree = () => readdirSync(ws.root, { recursive: true }).map(String).sort().join('\n')
    const before = tree()
    const env = ws.env({
      PLAYBOOK_TELEMETRY_URL: 'spool',
      PLAYBOOK_TELEMETRY_SPOOL_DIR: spoolDir,
      PLAYBOOK_RUN_ID: runId,
      PLAYBOOK_TELEMETRY_SCOPE: 'all',
    })
    assertSilentSuccess(await runEmitter(env, toolPayload(ws.root), { cwd: ws.root }), label)
    assert(tree() === before, `${label}: o worktree mudou`)
    const lines = external ? readJsonl(join(spoolDir, `${runId}.jsonl`)) : []
    const cached = Object.keys(strayLines(ws)).length
    assert(external ? lines.length === 1 && cached === 0 : cached === 1, `${label}: destino errado`)
    for (const line of lines) assertEnvelope(line)
  }
})

/** O diretório temporário está num sistema de arquivos que não distingue caixa (padrão no Windows e no macOS). */
function caseInsensitiveTmp() {
  const probe = mkdtempSync(join(tmpdir(), 'telemetry-suite-Caixa-'))
  try {
    return existsSync(join(dirname(probe), basename(probe).toLowerCase()))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

if (caseInsensitiveTmp()) {
  // Sem distinção de caixa, `<RAIZ>/spool` é um diretório dentro do projeto: o emissor tem de reconhecê-lo como tal.
  test('spool externo com a raiz em outra grafia (sistema de arquivos sem caixa): cache, nada no worktree', async () => {
    const ws = workspace()
    const respelled = join(dirname(ws.root), basename(ws.root).toUpperCase(), 'spool')
    const tree = () => readdirSync(ws.root, { recursive: true }).map(String).sort().join('\n')
    const before = tree()
    const env = ws.env({
      PLAYBOOK_TELEMETRY_URL: 'spool',
      PLAYBOOK_TELEMETRY_SPOOL_DIR: respelled,
      PLAYBOOK_RUN_ID: 'run_01J8Z3NDEKTSV4RRFFQ69G5FAV',
      PLAYBOOK_TELEMETRY_SCOPE: 'all',
    })
    assertSilentSuccess(await runEmitter(env, toolPayload(ws.root), { cwd: ws.root }), 'outra grafia')
    assert(tree() === before, 'outra grafia: o worktree mudou')
    assert(Object.keys(strayLines(ws)).length === 1, 'outra grafia: o evento não foi ao cache')
  })
}

if (process.platform !== 'win32') {
  // Arquivo especial plantado no worktree pelo agente observado: um `open` síncrono num FIFO sem leitor travaria o
  // emissor fora do alcance do watchdog. O emissor tem de recusar e seguir para o destino seguinte, no prazo.
  const fifoCases = [
    {
      name: 'tasks/<id>/telemetry.jsonl',
      fifo: (ws) => ws.taskSpool,
      next: (ws) => join(ws.root, '.claude', 'telemetry-spool.jsonl'),
    },
    { name: '.git/HEAD', fifo: (ws) => join(ws.root, '.git', 'HEAD'), next: (ws) => ws.taskSpool },
  ]
  for (const { name, fifo, next } of fifoCases) {
    test(`FIFO em ${name}: exit 0 em ≤ 1,5 s e o evento cai no destino seguinte`, async () => {
      const ws = workspace()
      rmSync(fifo(ws), { force: true })
      execFileSync('mkfifo', ['-m', '600', fifo(ws)])
      const result = await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: 'spool' }), toolPayload(ws.root))
      assertSilentSuccess(result, `FIFO em ${name}`)
      assertWithinBudget(result, `FIFO em ${name}`)
      const lines = readJsonl(next(ws))
      assert(lines.length === 1 && lines[0].type === 'tool.pre', `destino seguinte: ${lines.length} linhas`)
    })
  }
}

if (process.platform !== 'win32') {
  // Link físico plantado pelo agente no lugar do spool: a linha do evento (com `target.command` do agente) cairia no
  // arquivo de fora. O emissor recusa arquivo com mais de um nome e segue para o destino seguinte.
  test('link físico em tasks/<id>/telemetry.jsonl: o arquivo de fora fica intacto e o evento cai no .claude/', async () => {
    const ws = workspace()
    const outside = join(ws.root, '..', 'fora.txt')
    writeFileSync(outside, 'original\n')
    linkSync(outside, ws.taskSpool)
    const payload = toolPayload(ws.root, { tool_input: { command: 'echo "$(id)"', description: 'suite' } })
    const result = await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: 'spool' }), payload)
    assertSilentSuccess(result, 'link físico')
    assert(readFileSync(outside, 'utf8') === 'original\n', 'o arquivo de fora recebeu a linha do evento')
    const lines = readJsonl(join(ws.root, '.claude', 'telemetry-spool.jsonl'))
    assert(lines.length === 1 && lines[0].type === 'tool.pre', `destino seguinte: ${lines.length} linhas`)
  })
}

// Enchimento no comando para esconder a chamada: o texto livre tem teto antes da classificação e da redação, então o
// emissor termina no prazo e o evento chega ao spool.
for (const detail of ['standard', 'verbose']) {
  test(`comando Bash multilinha de ~7,7 MiB (${detail}): exit 0 em ≤ 1,5 s e uma linha no spool com command_head`, async () => {
    const ws = workspace()
    const command = `echo início\n${'echo enchimento 0123456789abcdefghijklmnopqrstuvwxyz\n'.repeat(150_000)}`
    const payload = toolPayload(ws.root, { tool_input: { command, description: 'enchimento' } })
    const env = ws.env({ PLAYBOOK_TELEMETRY_URL: 'spool', PLAYBOOK_TELEMETRY_DETAIL: detail })
    // cwd = raiz do projeto, como o runtime: um rastro deadline_before_payload (D1) cai no mesmo spool da task.
    const result = await runEmitter(env, payload, { cwd: ws.root })
    assertSilentSuccess(result, `comando grande (${detail})`)
    assertWithinBudget(result, `comando grande (${detail})`)
    const lines = readJsonl(ws.taskSpool)
    assert(lines.length === 1, `spool com ${lines.length} linhas; ${spoolNote(lines)}`)
    assert(lines[0].type === 'tool.pre', `linha ${lines[0].type}, esperava tool.pre; ${spoolNote(lines)}`)
    assertEnvelope(lines[0])
    assert(lines[0].data?.target?.command_head === 'echo', `command_head: ${lines[0].data?.target?.command_head}`)
  })
}

// Centenas de milhares de valores dentro dos 8 MiB: o `JSON.parse` sozinho passava do `timeout: 3` do runtime. O
// emissor barra antes do parse e o fato vira uma linha error{scope:'hook', code:'payload_too_complex'} no spool.
for (const [field, event] of [
  ['tool_input', 'PreToolUse'],
  ['tool_response', 'PostToolUse'],
]) {
  test(`${field} com 300 mil chaves: exit 0 em ≤ 1,5 s e error{payload_too_complex} no spool`, async () => {
    const ws = workspace()
    const wide = Object.fromEntries(Array.from({ length: 300_000 }, (_, index) => [`k${index}`, index]))
    const payload = toolPayload(ws.root, { hook_event_name: event, [field]: wide })
    const result = await runEmitter(ws.env({ PLAYBOOK_TELEMETRY_URL: 'spool' }), payload, {
      args: [`--event=${event}`],
      cwd: ws.root,
    })
    assertSilentSuccess(result, `${field} largo`)
    assertWithinBudget(result, `${field} largo`)
    const lines = readJsonl(ws.taskSpool)
    assert(lines.length === 1, `spool com ${lines.length} linhas; ${spoolNote(lines)}`)
    assertEnvelope(lines[0])
    const data = lines[0].data ?? {}
    assert(
      lines[0].type === 'error' && data.scope === 'hook' && data.code === 'payload_too_complex',
      `linha: ${lines[0].type} ${JSON.stringify(data)}; ${spoolNote(lines)}`,
    )
    assert(data.hook_event === event, `hook_event: ${data.hook_event}`)
  })
}

test('eventos entregues têm envelope v1 bem formado (ULID × ts, tipo, origem, 64 KiB)', async () => {
  const ws = workspace()
  const collector = await startCollector()
  const env = ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url })
  const payloads = [
    { session_id: 's', cwd: ws.root, hook_event_name: 'SessionStart', source: 'startup' },
    { session_id: 's', cwd: ws.root, hook_event_name: 'UserPromptSubmit', prompt: 'olá' },
    toolPayload(ws.root),
    toolPayload(ws.root, { hook_event_name: 'PostToolUse', tool_response: { stdout: 'x' }, duration_ms: 5 }),
    { session_id: 's', cwd: ws.root, hook_event_name: 'Stop' },
    { session_id: 's', cwd: ws.root, hook_event_name: 'SessionEnd', reason: 'other' },
  ]
  for (const payload of payloads) assertSilentSuccess(await runEmitter(env, payload), String(payload.hook_event_name))
  assert(collector.stored.size === payloads.length, `o coletor tem ${collector.stored.size}`)
  for (const event of collector.stored.values()) {
    assertEnvelope(event)
    assert(event.task_id === TASK, `task_id: ${event.task_id}`)
    assert(!JSON.stringify(event).includes(ws.root), 'caminho absoluto do projeto saiu da máquina')
  }
})

test('SubagentStop com ponteiro checkpoint no nível minimal: checkpoint:true, sem status e sem raw', async () => {
  const ws = workspace()
  const collector = await startCollector()
  const env = ws.env({ PLAYBOOK_TELEMETRY_URL: collector.url, PLAYBOOK_TELEMETRY_DETAIL: 'minimal' })
  const pointer = { agent: 'coder', status: 'checkpoint', artifact_path: `tasks/${TASK}/artifacts/coder-cp-01.md` }
  const payload = {
    session_id: 's',
    cwd: ws.root,
    hook_event_name: 'SubagentStop',
    agent_id: 'agent-suite',
    agent_type: 'coder',
    last_assistant_message: `fim\n\n\`\`\`json\n${JSON.stringify(pointer)}\n\`\`\``,
  }
  assertSilentSuccess(await runEmitter(env, payload), 'SubagentStop')
  const pointers = [...collector.stored.values()].filter((event) => event.type === 'handoff.pointer')
  assert(pointers.length === 1, `ponteiros no coletor: ${pointers.length}`)
  const data = pointers[0].data
  assert(data.checkpoint === true && data.valid === true, `data: ${JSON.stringify(data)}`)
  assert(!('status' in data), `status no fio: ${data.status}`)
  assert(!('raw' in data), 'raw saiu no nível minimal')
  assert(data.artifact_path === pointer.artifact_path, `artifact_path: ${data.artifact_path}`)
})

// ---------------------------------------------------------------------------------------------------------------------
// Execução

let failed = 0
process.stdout.write(`TAP version 13\n1..${tests.length}\n`)
// Os cenários de prazo dependem da CPU livre: a carga da máquina fica no diagnóstico para ler uma falha de tempo.
process.stdout.write(`# load average no início: ${loadAverage()} (${cpus().length} CPUs)\n`)
for (const [index, { name, fn }] of tests.entries()) {
  try {
    await fn()
    process.stdout.write(`ok ${index + 1} - ${name}\n`)
  } catch (error) {
    failed++
    process.stdout.write(
      `not ok ${index + 1} - ${name}\n  # ${String(error?.message ?? error).replaceAll('\n', ' ')}\n`,
    )
  }
}
for (const cleanup of cleanups.reverse()) await cleanup()
process.stdout.write(`# load average no fim: ${loadAverage()}\n`)
process.stdout.write(`# ${tests.length - failed}/${tests.length} ok\n`)
process.exitCode = failed === 0 ? 0 : 1
