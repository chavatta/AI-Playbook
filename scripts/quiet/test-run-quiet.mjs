#!/usr/bin/env node
// Suíte do run-quiet. Uso: node scripts/quiet/test-run-quiet.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dividir, resumir } from "./run-quiet.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
let ok = 0, falhas = 0;
const caso = (n, fn) => { try { fn(); ok++; console.log(`ok   ${n}`); } catch (e) { falhas++; console.log(`FALHA ${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const L = (n, f = (i) => `ok ${i}`) => Array.from({ length: n }, (_, i) => f(i));

caso("passou: só o resumo final", () => {
  const out = resumir([...L(1000), "Tests: 1000 passed"], 60);
  assert(out.length === 8 && out.at(-1) === "Tests: 1000 passed", out.join("|"));
});

caso("falha no meio: linha da falha, a seguinte e o resumo", () => {
  const linhas = [...L(300), "FAIL tests/x.test > caso", "  at x.ts:3", ...L(300), "1 failed"];
  const out = resumir(linhas, 60);
  assert(out.includes("FAIL tests/x.test > caso") && out.includes("  at x.ts:3") && out.includes("— resumo —") && out.at(-1) === "1 failed", out.join("|"));
  assert(!out.includes("ok 5"), "não despeja linhas boas");
});

caso("reconhece falhas de ecossistemas diferentes", () => {
  for (const l of ["FAILED test_a.py::test_x", "error[E0308]: mismatched types", "--- FAIL: TestX (0.00s)", "Traceback (most recent call last):", "not ok 3 - soma", "✕ soma (2 ms)", "src/a.ts:1:1 - error: x"]) {
    const out = resumir([...L(50), l, ...L(50)], 60);
    assert(out.includes(l), `não pegou: ${l}`);
  }
});

caso("muitas falhas: respeita o teto e diz quantas ficaram no arquivo", () => {
  const out = resumir([...L(10, (i) => `ERROR caso ${i}`), ...L(100, () => "ERROR repetido"), ...L(20)], 20);
  assert(out.length <= 20 && out.some((l) => /\+\d+ linhas de falha no arquivo/.test(l)), out.join("|"));
});

caso("dividir: aspas, escapes e recusa de metacaractere de shell", () => {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(eq(dividir("npm  run test"), ["npm", "run", "test"]), "espaços");
  assert(eq(dividir(`node -e "a;b|c" 'x y'`), ["node", "-e", "a;b|c", "x y"]), "aspas");
  assert(eq(dividir(`echo "a\\"b"`), ["echo", 'a"b']), "escape em aspas duplas");
  assert(eq(dividir(`echo ""`), ["echo", ""]), "argumento vazio entre aspas");
  for (const m of ["a | b", "a && b", "a; b", "a > f", "echo $HOME", "echo `id`", "a $(id)", `echo "x`]) assert(dividir(m) === null, `devia recusar: ${m}`);
});

caso("CLI: argumentos separados depois de -- rodam sem shell", () => {
  const r = spawnSync(process.execPath, [join(AQUI, "run-quiet.mjs"), "teste", "--", process.execPath, "-e", "console.log('a;b|c')"], { encoding: "utf8" });
  assert(r.status === 0 && /a;b\|c/.test(r.stdout), r.stdout + r.stderr);
});

caso("CLI: metacaractere de shell fora de aspas é recusado com código 2", () => {
  const r = spawnSync(process.execPath, [join(AQUI, "run-quiet.mjs"), "teste", "--", "echo a | cat"], { encoding: "utf8" });
  assert(r.status === 2 && /metacaractere de shell/.test(r.stderr), r.stderr);
});

caso("CLI: comando inexistente sai com 127 e diz o motivo", () => {
  const r = spawnSync(process.execPath, [join(AQUI, "run-quiet.mjs"), "teste", "--", "comando-que-nao-existe-xyz", "a"], { encoding: "utf8" });
  assert(r.status === 127 && /não foi possível executar comando-que-nao-existe-xyz/.test(r.stdout), r.stdout + r.stderr);
});

caso("CLI: devolve o código do comando e aponta o arquivo completo", () => {
  const r = spawnSync(process.execPath, [join(AQUI, "run-quiet.mjs"), "teste", "--", "node -e \"for(let i=0;i<300;i++)console.log('ok',i);console.error('FAIL x');process.exit(3)\""], { encoding: "utf8" });
  assert(r.status === 3, `código ${r.status}`);
  assert(/FAIL x/.test(r.stdout) && /301 linhas completas em /.test(r.stdout), r.stdout);
  assert(r.stdout.split("\n").length < 70, "saída curta");
});

caso("CLI: sem comando nem perfil preenchido, pede o comando", () => {
  const r = spawnSync(process.execPath, [join(AQUI, "lint-quiet.mjs")], { encoding: "utf8", cwd: join(AQUI, "..", "..") });
  assert(r.status === 2 && /comandos_quiet\.lint/.test(r.stderr), r.stderr);
});

console.log(`\n${ok}/${ok + falhas}`);
process.exit(falhas ? 1 : 0);
