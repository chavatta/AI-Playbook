#!/usr/bin/env node
// Liga e desliga o portal de gestão em segundo plano — o mesmo comando em Windows, macOS e Linux.
// Idempotente, independente da sessão do Claude Code, sem tarefa agendada nem alteração de sistema.
//   node gestao/painel.mjs iniciar   (ou: start)    sobe em segundo plano; se já está no ar, só informa
//   node gestao/painel.mjs parar     (ou: stop)     encerra; se não está no ar, só informa
//   node gestao/painel.mjs status                   diz se está no ar e onde
// Porta: variável GESTAO_PORT (padrão 4317). Log: <pasta temporária>/playbook-gestao-<porta>.log
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(process.env.GESTAO_ROOT || path.join(AQUI, '..'))
const PORTA = Number(process.env.GESTAO_PORT || 4317)
const PID = path.join(os.tmpdir(), `playbook-gestao-${PORTA}.pid`)
const LOG = path.join(os.tmpdir(), `playbook-gestao-${PORTA}.log`)
const URL = `http://localhost:${PORTA}`

const viva = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const lerPid = () => { try { const n = Number(fs.readFileSync(PID, 'utf8')); return n > 0 ? n : 0 } catch { return 0 } }
const portaAberta = () => new Promise((ok) => {
  const s = net.connect({ host: '127.0.0.1', port: PORTA })
  s.once('connect', () => { s.destroy(); ok(true) })
  s.once('error', () => ok(false))
  s.setTimeout(1000, () => { s.destroy(); ok(false) })
})
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function iniciar() {
  const pid = lerPid()
  if ((pid && viva(pid)) || await portaAberta()) return console.log(`Portal já está rodando em ${URL}`)
  const log = fs.openSync(LOG, 'a')
  const filho = spawn(process.execPath, [path.join(AQUI, 'serve.mjs')], {
    cwd: RAIZ, detached: true, stdio: ['ignore', log, log], windowsHide: true,
    env: { ...process.env, GESTAO_PORT: String(PORTA), GESTAO_ROOT: RAIZ },
  })
  filho.unref()
  fs.writeFileSync(PID, String(filho.pid))
  for (let i = 0; i < 20; i++) { await espera(250); if (await portaAberta()) return console.log(`Portal iniciado em ${URL}`) }
  try { fs.unlinkSync(PID) } catch {}
  console.log(`Portal não subiu (porta ${PORTA} em uso por outro programa?). Veja ${LOG}`)
  process.exitCode = 1
}

async function parar() {
  const pid = lerPid()
  if (pid && viva(pid)) {
    try { process.kill(pid) } catch (e) { console.log(`Não consegui parar o processo ${pid}: ${e.message}`); process.exitCode = 1; return }
    try { fs.unlinkSync(PID) } catch {}
    return console.log('Portal parado')
  }
  try { fs.unlinkSync(PID) } catch {}
  console.log((await portaAberta())
    ? `Há algo na porta ${PORTA} que este script não iniciou; não encerrei. Pare-o por onde foi iniciado.`
    : 'Portal não estava rodando')
}

async function status() {
  console.log((await portaAberta()) ? `Portal no ar em ${URL}` : 'Portal parado')
}

const cmd = (process.argv[2] || '').toLowerCase()
const acoes = { iniciar, start: iniciar, parar, stop: parar, status }
if (!acoes[cmd]) { console.log('Uso: node gestao/painel.mjs iniciar | parar | status   (porta: GESTAO_PORT)'); process.exit(cmd ? 1 : 0) }
await acoes[cmd]()
