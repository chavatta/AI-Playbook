#!/usr/bin/env node
// Suíte do scripts/plano-assinatura.mjs (docs/ADR-010). Roda o script num diretório temporário com o status do CLI
// simulado (--auth-json) e um settings de teste (--settings): não toca .claude/settings.local.json nem chama o CLI.
// Uso: node scripts/test-plano-assinatura.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/plano-assinatura.mjs");
const OPUS = "claude-opus-5-5";
const dir = mkdtempSync(join(tmpdir(), "plano-"));
let n = 0;

function roda({ auth, settings, args = [], env = {} }) {
  const caso = join(dir, String(++n));
  const cfg = `${caso}-settings.json`, aut = `${caso}-auth.json`;
  if (settings !== undefined) writeFileSync(cfg, typeof settings === "string" ? settings : JSON.stringify(settings));
  if (auth !== undefined) writeFileSync(aut, JSON.stringify(auth));
  const base = { ...process.env };
  delete base.PLAYBOOK_PLANO; delete base.ANTHROPIC_DEFAULT_FABLE_MODEL;
  const r = spawnSync(process.execPath, [SCRIPT, "--settings", cfg, ...(auth !== undefined ? ["--auth-json", aut] : []), ...args],
    { encoding: "utf8", env: { ...base, ...env } });
  const lido = existsSync(cfg) ? readFileSync(cfg, "utf8") : null;
  let json = null; try { json = lido && JSON.parse(lido); } catch {}
  return { code: r.status, out: r.stdout + r.stderr, raw: lido, json, envOut: json && json.env };
}

const OAUTH = (o) => ({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", ...o });
const CASES = [
  ["max → PLAYBOOK_PLANO=max, alias fable intacto",
    () => roda({ auth: OAUTH({ subscriptionType: "max" }) }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "max" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["ultra → gravado como max, alias fable intacto",
    () => roda({ auth: OAUTH({ subscriptionType: "ultra" }) }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "max" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut) && /subscriptionType=ultra/.test(r.out)],

  ["--plano ultra → max; limpa o Opus que o pro tinha posto",
    () => roda({ args: ["--plano", "ultra"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } } }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "max" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["pro → alias fable apontado para o Opus",
    () => roda({ auth: OAUTH({ subscriptionType: "pro" }) }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "pro" && r.envOut.ANTHROPIC_DEFAULT_FABLE_MODEL === OPUS && /crédito avulso/.test(r.out)],

  ["team sem --assento → sai 2 e não grava",
    () => roda({ auth: OAUTH({ subscriptionType: "team" }) }),
    (r) => r.code === 2 && r.raw === null && /--assento/.test(r.out)],

  ["team + --assento premium → team-premium, Fable",
    () => roda({ auth: OAUTH({ subscriptionType: "team" }), args: ["--assento", "premium"] }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "team-premium" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["enterprise + --assento standard → Opus",
    () => roda({ auth: OAUTH({ subscriptionType: "enterprise" }), args: ["--assento", "standard"] }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "enterprise-standard" && r.envOut.ANTHROPIC_DEFAULT_FABLE_MODEL === OPUS],

  ["subscriptionType ausente → sai 2 pedindo --plano, sem gravar",
    () => roda({ auth: { loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty" } }),
    (r) => r.code === 2 && r.raw === null && /--plano/.test(r.out)],

  ["provedor de terceiros → api, Fable",
    () => roda({ auth: OAUTH({ apiProvider: "bedrock" }) }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "api" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["--plano vence a detecção (CLI diz pro, dev declara max)",
    () => roda({ auth: OAUTH({ subscriptionType: "pro" }), args: ["--plano", "max"] }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "max" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["--plano inválido → sai 2",
    () => roda({ args: ["--plano", "gratis"] }),
    (r) => r.code === 2 && r.raw === null],

  ["preserva o resto do settings.local.json",
    () => roda({ auth: OAUTH({ subscriptionType: "pro" }), settings: { permissions: { allow: ["Bash(ls:*)"] }, env: { FOO: "1" } } }),
    (r) => r.code === 0 && r.json.permissions.allow[0] === "Bash(ls:*)" && r.envOut.FOO === "1" && r.envOut.PLAYBOOK_PLANO === "pro"],

  ["pro → max remove o override que o próprio script pôs",
    () => roda({ args: ["--plano", "max"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } } }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "max" && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["max mantém override de fable que não é do script, com aviso",
    () => roda({ args: ["--plano", "max"], settings: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5" } } }),
    (r) => r.code === 0 && r.envOut.ANTHROPIC_DEFAULT_FABLE_MODEL === "claude-fable-5" && /Aviso/.test(r.out)],

  ["settings com JSON inválido → sai 4 e não sobrescreve",
    () => roda({ args: ["--plano", "pro"], settings: "{ quebrado" }),
    (r) => r.code === 4 && r.raw === "{ quebrado"],

  ["--verificar sem plano → sai 1",
    () => roda({ args: ["--verificar"], settings: {} }),
    (r) => r.code === 1],

  ["--verificar com sessão aberta antes da gravação → sai 3",
    () => roda({ args: ["--verificar"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } } }),
    (r) => r.code === 3 && /Reinicie/.test(r.out)],

  ["--verificar com sessão em dia → sai 0 e diz o modelo do SRE",
    () => roda({ args: ["--verificar"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } },
      env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } }),
    (r) => r.code === 0 && /Opus/.test(r.out)],

  ["--verificar: sessão em dia sem ANTHROPIC_DEFAULT_FABLE_MODEL no shell (o Claude Code não repassa) → sai 0",
    () => roda({ args: ["--verificar"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS } }, env: { PLAYBOOK_PLANO: "pro" } }),
    (r) => r.code === 0 && /Opus/.test(r.out)],

  ["--verificar: trocou para max mas a sessão ainda tem o plano pro → sai 3",
    () => roda({ args: ["--verificar"], settings: { env: { PLAYBOOK_PLANO: "max" } }, env: { PLAYBOOK_PLANO: "pro" } }),
    (r) => r.code === 3],

  ["--verificar não grava nada",
    () => roda({ args: ["--verificar"], settings: { env: { PLAYBOOK_PLANO: "max" } }, env: { PLAYBOOK_PLANO: "max" } }),
    (r) => r.code === 0 && r.raw === JSON.stringify({ env: { PLAYBOOK_PLANO: "max" } })],

  ["--telemetria: grava spool e o id, sem arquivo prévio",
    () => roda({ args: ["--telemetria", "--projeto", "meu-proj"] }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_TELEMETRY_URL === "spool" && r.envOut.PLAYBOOK_PROJECT_ID === "meu-proj"],

  ["--telemetria preserva as demais chaves (dentro e fora do env)",
    () => roda({ args: ["--telemetria", "--projeto", "x1"], settings: { env: { PLAYBOOK_PLANO: "pro", ANTHROPIC_DEFAULT_FABLE_MODEL: OPUS }, permissions: { allow: ["Bash(ls)"] } } }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_PLANO === "pro" && r.envOut.ANTHROPIC_DEFAULT_FABLE_MODEL === OPUS && r.json.permissions.allow[0] === "Bash(ls)" && r.envOut.PLAYBOOK_TELEMETRY_URL === "spool"],

  ["--telemetria é idempotente: a segunda execução deixa o arquivo igual",
    () => { const a = roda({ args: ["--telemetria", "--projeto", "x1"] }); const b = roda({ args: ["--telemetria"], settings: a.json }); return { ...b, antes: JSON.stringify(a.json) }; },
    (r) => r.code === 0 && r.raw === r.antes],

  ["--telemetria sem --projeto mantém o id gravado; com --projeto troca",
    () => { const a = roda({ args: ["--telemetria"], settings: { env: { PLAYBOOK_PROJECT_ID: "antigo" } } }); const b = roda({ args: ["--telemetria", "--projeto", "novo"], settings: { env: { PLAYBOOK_PROJECT_ID: "antigo" } } }); return { ...a, novo: b.envOut.PLAYBOOK_PROJECT_ID }; },
    (r) => r.envOut.PLAYBOOK_PROJECT_ID === "antigo" && r.novo === "novo"],

  ["--telemetria sem id e sem --projeto: usa o nome da pasta em kebab-case",
    () => roda({ args: ["--telemetria"] }),
    (r) => r.code === 0 && /^[a-z0-9][a-z0-9-]{0,63}$/.test(r.envOut.PLAYBOOK_PROJECT_ID)],

  ["--telemetria com --projeto inválido → sai 2 e não grava",
    () => roda({ args: ["--telemetria", "--projeto", "Meu Proj!"], settings: { env: { PLAYBOOK_PLANO: "pro" } } }),
    (r) => r.code === 2 && r.raw === JSON.stringify({ env: { PLAYBOOK_PLANO: "pro" } })],

  ["--telemetria não impõe spool sobre um coletor já configurado",
    () => roda({ args: ["--telemetria", "--projeto", "x1"], settings: { env: { PLAYBOOK_TELEMETRY_URL: "https://coletor.exemplo/ingest" } } }),
    (r) => r.code === 0 && r.envOut.PLAYBOOK_TELEMETRY_URL === "https://coletor.exemplo/ingest" && /mantida/.test(r.out)],

  ["--telemetria não toca no plano nem no alias fable",
    () => roda({ args: ["--telemetria", "--projeto", "x1"] }),
    (r) => r.code === 0 && !("PLAYBOOK_PLANO" in r.envOut) && !("ANTHROPIC_DEFAULT_FABLE_MODEL" in r.envOut)],

  ["--verificar-telemetria: desligada → sai 1",
    () => roda({ args: ["--verificar-telemetria"], settings: { env: { PLAYBOOK_PLANO: "pro" } } }),
    (r) => r.code === 1],

  ["--verificar-telemetria: ligada e sessão em dia → sai 0, sem gravar",
    () => roda({ args: ["--verificar-telemetria"], settings: { env: { PLAYBOOK_TELEMETRY_URL: "spool" } }, env: { PLAYBOOK_TELEMETRY_URL: "spool" } }),
    (r) => r.code === 0 && r.raw === JSON.stringify({ env: { PLAYBOOK_TELEMETRY_URL: "spool" } })],

  ["--verificar-telemetria: gravada mas a sessão foi aberta antes → sai 3",
    () => roda({ args: ["--verificar-telemetria"], settings: { env: { PLAYBOOK_TELEMETRY_URL: "spool" } }, env: { PLAYBOOK_TELEMETRY_URL: "" } }),
    (r) => r.code === 3],
];

let pass = 0;
const falhas = [];
for (const [desc, exec, check] of CASES) {
  const r = exec();
  let ok = false;
  try { ok = !!check(r); } catch { ok = false; }
  if (ok) pass++; else falhas.push(`  [falhou] ${desc}\n      code=${r.code} saída=${r.out.trim().split("\n").join(" | ")}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(`plano-assinatura: passou ${pass}/${CASES.length}`);
if (falhas.length) { console.log(falhas.join("\n")); process.exit(1); }
