#!/usr/bin/env node
// Suíte do scripts/playbook-update.mjs. Usa um repositório git local como "GitHub": sem rede, sem modelo.
// Uso: node scripts/test-playbook-update.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const SCRIPT = resolve("scripts/playbook-update.mjs");
const base = mkdtempSync(join(tmpdir(), "pbupd-"));
const remoto = join(base, "remoto");
const projeto = join(base, "projeto");

const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const escreve = (raiz, rel, txt) => { const p = join(raiz, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt); };
const commit = (msg) => { git(remoto, "add", "-A"); git(remoto, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg); return git(remoto, "rev-parse", "HEAD").stdout.trim(); };
const roda = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: projeto, env: { ...process.env, PLAYBOOK_ROOT: projeto, PLAYBOOK_REPO: remoto, PLAYBOOK_BRANCH: "main" } });

mkdirSync(remoto, { recursive: true }); mkdirSync(projeto, { recursive: true });
git(remoto, "init", "-q", "-b", "main");
escreve(remoto, "README.md", "v1");
escreve(remoto, ".claude/hooks/h.mjs", "v1");
escreve(remoto, "praticas/00-stack-e-defaults.md", "remoto");
const sha1 = commit("v1");
escreve(projeto, "README.md", "v1");
escreve(projeto, ".claude/hooks/h.mjs", "v1");
escreve(projeto, "praticas/00-stack-e-defaults.md", "do projeto");
escreve(projeto, "tasks/x/brief.md", "meu");
escreve(projeto, "gestao/projeto.json", "dados do projeto");

const casos = [];
const caso = (nome, f) => { let ok = false, det = ""; try { const r = f(); ok = r === true; det = ok ? "" : String(r); } catch (e) { det = e.message; } casos.push([nome, ok, det]); };

caso("sem registro → 11", () => roda("--verificar").status === 11);
caso("registrar grava o sha do remoto", () => { const r = roda("--registrar"); return r.status === 0 && JSON.parse(readFileSync(join(projeto, ".playbook-sync.json"), "utf8")).sha === sha1; });
caso("mesma versão → 0", () => roda("--verificar").status === 0);

escreve(remoto, "README.md", "v2");
escreve(remoto, ".claude/hooks/h.mjs", "v2");
escreve(remoto, "docs/novo.md", "novo");
escreve(remoto, "praticas/00-stack-e-defaults.md", "remoto mudou");
escreve(remoto, "tasks/y/brief.md", "do remoto");
escreve(remoto, "gestao/projeto.json", "template do remoto");
escreve(remoto, "gestao/serve.mjs", "portal v2");
const sha2 = commit("v2");

caso("versão diferente → 10", () => roda("--verificar").status === 10);
caso("--verificar não baixa nada", () => !existsSync(join(projeto, ".playbook-update")));
caso("--baixar faz staging e marca protegido", () => {
  const r = roda("--baixar");
  const ch = join(projeto, ".playbook-update", sha2.slice(0, 7), "CHANGES.txt");
  const txt = existsSync(ch) ? readFileSync(ch, "utf8") : "";
  return r.status === 0 && /M README\.md/.test(txt) && /M \.claude\/hooks\/h\.mjs\s+\[PROTEGIDO\]/.test(txt) && /A docs\/novo\.md/.test(txt) || `${r.status} ${r.stdout}${r.stderr}`;
});
caso("--baixar não toca arquivo versionado", () => readFileSync(join(projeto, "README.md"), "utf8") === "v1" && readFileSync(join(projeto, ".claude/hooks/h.mjs"), "utf8") === "v1");
caso("staging traz o arquivo novo", () => readFileSync(join(projeto, ".playbook-update", sha2.slice(0, 7), "arquivos/README.md"), "utf8") === "v2");
caso("perfil do projeto e tasks/ ficam fora da comparação", () => {
  const txt = readFileSync(join(projeto, ".playbook-update", sha2.slice(0, 7), "CHANGES.txt"), "utf8");
  return !/00-stack-e-defaults/.test(txt) && !/tasks\//.test(txt);
});
caso("gestao/projeto.json é dado do projeto: fora da comparação e nunca sobrescrito; o portal (serve.mjs) entra", () => {
  const txt = readFileSync(join(projeto, ".playbook-update", sha2.slice(0, 7), "CHANGES.txt"), "utf8");
  return !/gestao\/projeto\.json/.test(txt) && /A gestao\/serve\.mjs/.test(txt) && readFileSync(join(projeto, "gestao/projeto.json"), "utf8") === "dados do projeto" && !existsSync(join(projeto, ".playbook-update", sha2.slice(0, 7), "arquivos/gestao/projeto.json")) || txt;
});
caso("depois de registrar → 0", () => roda("--registrar").status === 0 && roda("--verificar").status === 0);
caso("remoto inacessível → 12 (não bloqueia)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--verificar"], { encoding: "utf8", cwd: projeto, env: { ...process.env, PLAYBOOK_ROOT: projeto, PLAYBOOK_REPO: join(base, "nao-existe"), PLAYBOOK_BRANCH: "main" } });
  return r.status === 12;
});
caso("modo inválido → 1", () => roda("--xyz").status === 1);

let ok = 0;
for (const [nome, passou, det] of casos) { console.log(`${passou ? "ok  " : "FALHA"} ${nome}${det ? "  → " + det : ""}`); if (passou) ok++; }
console.log(`\nplaybook-update: passou ${ok}/${casos.length}`);
rmSync(base, { recursive: true, force: true });
process.exit(ok === casos.length ? 0 : 1);
