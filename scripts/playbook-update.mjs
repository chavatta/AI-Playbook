#!/usr/bin/env node
// Checa se o playbook deste projeto está na mesma versão do GitHub e, se não estiver, baixa a nova
// para uma pasta de staging (.playbook-update/, ignorada pelo git). Nunca sobrescreve arquivo versionado:
// hook, agente e workflow só mudam em branch, com teste, pelo Tech Lead (GOVERNANCE.md §6).
//
// Uso:
//   node scripts/playbook-update.mjs --verificar          compara e sai com código (abaixo); não baixa
//   node scripts/playbook-update.mjs --baixar             baixa para .playbook-update/<sha7>/ e lista o que mudou
//   node scripts/playbook-update.mjs --registrar [sha]    grava a versão adotada em .playbook-sync.json
//
// Códigos de saída: 0 igual · 10 diferente · 11 sem registro de versão · 12 sem rede (não bloqueia)
// Fonte: playbook.json (repo, branch). PLAYBOOK_REPO / PLAYBOOK_BRANCH sobrescrevem (usado nos testes).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = resolve(process.env.PLAYBOOK_ROOT || process.cwd());
const ESTADO = join(RAIZ, ".playbook-sync.json");
const STAGING = join(RAIZ, ".playbook-update");
const TIMEOUT_MS = 15000;

// Fora da comparação: é do projeto, não do playbook.
const IGNORAR = [".git/", ".playbook-update/", "tasks/", ".claude/settings.local.json", ".playbook-sync.json", "praticas/00-stack-e-defaults.md"];
// Zona protegida (GOVERNANCE.md §6.2): mudança aqui exige o ciclo do Tech Lead.
const PROTEGIDOS = [".claude/settings.json", ".claude/hooks/", ".claude/workflows/", ".claude/agents/", "GOVERNANCE.md"];

function sair(codigo, msg) { if (msg) console.log(msg); process.exit(codigo); }

function config() {
  let c = {};
  const p = join(RAIZ, "playbook.json");
  if (existsSync(p)) c = JSON.parse(readFileSync(p, "utf8"));
  const repo = process.env.PLAYBOOK_REPO || c.repo;
  const branch = process.env.PLAYBOOK_BRANCH || c.branch || "main";
  if (!repo) sair(12, "playbook-update: sem repo em playbook.json.");
  return { repo, branch };
}

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function shaRemoto({ repo, branch }) {
  try {
    const linha = git(["ls-remote", repo, `refs/heads/${branch}`]);
    const sha = linha.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha)) sair(12, `playbook-update: branch ${branch} não encontrada em ${repo}.`);
    return sha;
  } catch (e) {
    return sair(12, `playbook-update: não consegui consultar ${repo} (${(e.message || "").split("\n")[0]}). Sigo sem checar.`);
  }
}

function lerEstado() {
  if (!existsSync(ESTADO)) return null;
  try { return JSON.parse(readFileSync(ESTADO, "utf8")); } catch { return null; }
}

function gravarEstado(sha, cfg) {
  writeFileSync(ESTADO, JSON.stringify({ repo: cfg.repo, branch: cfg.branch, sha, registrado_em: new Date().toISOString() }, null, 2) + "\n");
}

function ignorado(rel) { return IGNORAR.some((i) => rel === i || rel.startsWith(i)); }
function protegido(rel) { return PROTEGIDOS.some((i) => rel === i || rel.startsWith(i)); }

function listar(base) {
  const out = [];
  (function anda(dir) {
    for (const nome of readdirSync(dir)) {
      const abs = join(dir, nome);
      const rel = relative(base, abs).split("\\").join("/");
      if (nome === ".git") continue;
      if (statSync(abs).isDirectory()) { if (!ignorado(rel + "/")) anda(abs); }
      else if (!ignorado(rel)) out.push(rel);
    }
  })(base);
  return out.sort();
}

function iguais(a, b) { return readFileSync(a).equals(readFileSync(b)); }

function verificar() {
  const cfg = config();
  const remoto = shaRemoto(cfg);
  const estado = lerEstado();
  if (!estado) sair(11, `playbook-update: este projeto não registra a versão do playbook. Remoto em ${remoto.slice(0, 7)}. Se está atualizado, rode: node scripts/playbook-update.mjs --registrar`);
  if (estado.sha === remoto) sair(0, `playbook-update: em dia (${remoto.slice(0, 7)}).`);
  sair(10, `playbook-update: versão diferente. Local ${estado.sha.slice(0, 7)}, GitHub ${remoto.slice(0, 7)}. Rode: node scripts/playbook-update.mjs --baixar`);
}

function baixar() {
  const cfg = config();
  const remoto = shaRemoto(cfg);
  const destino = join(STAGING, remoto.slice(0, 7));
  const tmp = mkdtempSync(join(tmpdir(), "playbook-"));
  try {
    git(["clone", "--quiet", "--depth", "1", "--branch", cfg.branch, cfg.repo, tmp], { timeout: 120000 });
    const novos = listar(tmp);
    const locais = new Set(listar(RAIZ));
    const adicionados = [], alterados = [], removidos = [];
    for (const rel of novos) {
      if (!locais.has(rel)) adicionados.push(rel);
      else if (!iguais(join(tmp, rel), join(RAIZ, rel))) alterados.push(rel);
    }
    const setNovos = new Set(novos);
    for (const rel of locais) if (!setNovos.has(rel)) removidos.push(rel);

    if (existsSync(destino)) rmSync(destino, { recursive: true, force: true });
    for (const rel of [...adicionados, ...alterados]) {
      const alvo = join(destino, "arquivos", rel);
      mkdirSync(dirname(alvo), { recursive: true });
      copyFileSync(join(tmp, rel), alvo);
    }
    const marca = (rel) => (protegido(rel) ? "  [PROTEGIDO]" : "");
    const linhas = [
      `Playbook ${remoto} (${cfg.branch})`,
      `Adicionados: ${adicionados.length} · Alterados: ${alterados.length} · Só no projeto: ${removidos.length}`,
      "",
      ...alterados.map((r) => `M ${r}${marca(r)}`),
      ...adicionados.map((r) => `A ${r}${marca(r)}`),
      ...removidos.map((r) => `? ${r}  (não existe mais no playbook; confira antes de apagar)`),
    ];
    mkdirSync(destino, { recursive: true });
    writeFileSync(join(destino, "CHANGES.txt"), linhas.join("\n") + "\n");
    const prot = [...alterados, ...adicionados].filter(protegido);
    console.log(linhas.join("\n"));
    console.log(`\nStaging em ${relative(RAIZ, destino)}/ (arquivos novos em arquivos/). Nada foi aplicado.`);
    if (prot.length) console.log(`Atenção: ${prot.length} arquivo(s) da zona protegida mudaram. Aplique em branch, fora do Claude Code, rode as suítes e reinicie a sessão.`);
    console.log("Depois de aplicar: node scripts/playbook-update.mjs --registrar");
  } catch (e) {
    sair(12, `playbook-update: falha ao baixar (${(e.message || "").split("\n")[0]}).`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function registrar(arg) {
  const cfg = config();
  const sha = arg || shaRemoto(cfg);
  if (!/^[0-9a-f]{40}$/.test(sha)) sair(1, "playbook-update: informe o sha completo (40 caracteres) ou rode sem argumento.");
  gravarEstado(sha, cfg);
  console.log(`playbook-update: versão registrada ${sha.slice(0, 7)} em .playbook-sync.json.`);
}

const [modo, arg] = process.argv.slice(2);
if (modo === "--verificar") verificar();
else if (modo === "--baixar") baixar();
else if (modo === "--registrar") registrar(arg);
else sair(1, "Uso: node scripts/playbook-update.mjs --verificar | --baixar | --registrar [sha]");
