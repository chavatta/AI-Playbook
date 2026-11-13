#!/usr/bin/env node
// Declara nesta máquina o plano de assinatura do Claude Code e, a partir dele, o modelo do Security-SRE (docs/ADR-010).
//
// No Pro e em assento standard de Team/Enterprise o Fable não entra no limite do plano: sai em crédito avulso desde
// a primeira mensagem. Nesses planos o script aponta o alias `fable` para o Opus (ANTHROPIC_DEFAULT_FABLE_MODEL), e o
// Security-SRE — que declara `model: fable` — roda em Opus em qualquer caminho de delegação (/task, Orchestrator ou à mão).
// Nos planos com Fable incluído (Max, Ultra, assento premium) ou cobrados por API, o alias fica intacto.
// Ultra tem a mesma regra de Fable do Max (limite semanal próprio, incluído no plano): é gravado como `max`, que é o
// valor que o Security-SRE e o playbook-task.js conhecem. Assim o Ultra não exige mudar arquivo protegido.
//
// Grava só em .claude/settings.local.json (gitignored, por máquina), no bloco `env`, preservando o resto do arquivo.
// O `env` do settings carrega no startup: depois de gravar, reinicie as sessões do Claude Code.
//
// Uso:
//   node scripts/plano-assinatura.mjs                       detecta por `claude auth status --json` e grava
//   node scripts/plano-assinatura.mjs --plano pro           declara à mão (vence a detecção); --plano ultra grava max
//   node scripts/plano-assinatura.mjs --assento premium     completa a detecção de Team/Enterprise (premium | standard)
//   node scripts/plano-assinatura.mjs --verificar           só confere; sai 0 configurado, 1 sem plano, 3 sessão desatualizada
//   node scripts/plano-assinatura.mjs --telemetria [--projeto <id>]  liga a telemetria desta máquina (passo à parte, idempotente): grava
//                                                           PLAYBOOK_TELEMETRY_URL=spool e PLAYBOOK_PROJECT_ID, preservando o resto
//   node scripts/plano-assinatura.mjs --verificar-telemetria  só confere; sai 0 ligada, 1 desligada, 3 gravada mas sessão desatualizada
// Para teste: --auth-json <arquivo> (no lugar de rodar o CLI) e --settings <arquivo> (no lugar de .claude/settings.local.json).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const OPUS_PARA_SRE = "claude-opus-5-5";   // atualizar junto com o piso do ADR-010 quando o Opus subir de versão
const PLANOS = ["pro", "max", "team-standard", "team-premium", "enterprise-standard", "enterprise-premium", "api"];
const FABLE_INCLUSO = new Set(["max", "team-premium", "enterprise-premium", "api"]);
const SINONIMOS = { ultra: "max" };   // mesma regra de Fable; o valor gravado é o canônico

const argv = process.argv.slice(2);
const opt = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const SETTINGS = opt("--settings") || ".claude/settings.local.json";
const sair = (codigo, msg) => { console.log(msg); process.exit(codigo); };

function lerSettings() {
  if (!existsSync(SETTINGS)) return {};
  try { return JSON.parse(readFileSync(SETTINGS, "utf8")); }
  catch (e) { sair(4, `ERRO: ${SETTINGS} não é JSON válido (${e.message}). Corrija à mão; nada foi gravado.`); }
}

function detectar() {
  let status;
  try {
    const texto = opt("--auth-json") ? readFileSync(opt("--auth-json"), "utf8") : execFileSync("claude", ["auth", "status", "--json"], { encoding: "utf8" });
    status = JSON.parse(texto);
  } catch (e) {
    sair(2, `Não consegui ler \`claude auth status --json\` (${e.message.split("\n")[0]}). Declare à mão: --plano <${PLANOS.join(" | ")}>.`);
  }
  if (status.apiProvider && status.apiProvider !== "firstParty") return { plano: "api", fonte: `apiProvider=${status.apiProvider}` };
  if (/api.?key/i.test(String(status.authMethod || ""))) return { plano: "api", fonte: `authMethod=${status.authMethod}` };
  const tipo = String(status.subscriptionType || "").toLowerCase();
  if (tipo === "pro" || tipo === "max") return { plano: tipo, fonte: `subscriptionType=${tipo}` };
  if (SINONIMOS[tipo]) return { plano: SINONIMOS[tipo], fonte: `subscriptionType=${tipo} (mesma regra do ${SINONIMOS[tipo]})` };
  if (tipo === "team" || tipo === "enterprise") {
    const assento = opt("--assento");
    if (assento !== "premium" && assento !== "standard") {
      sair(2, `Plano ${tipo}: o Fable depende do tipo de assento, que o CLI não informa. Rode de novo com --assento premium ou --assento standard.`);
    }
    return { plano: `${tipo}-${assento}`, fonte: `subscriptionType=${tipo} + --assento ${assento}` };
  }
  sair(2, `O CLI não informou o plano (subscriptionType=${status.subscriptionType ?? "ausente"}). Declare à mão: --plano <${PLANOS.join(" | ")}>.`);
}

const s = lerSettings();
const env = (s.env && typeof s.env === "object") ? s.env : {};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

// Telemetria por máquina (docs/ADR-008, docs/telemetria/README.md): o spool local alimenta o portal de gestão (gestao/).
// Não mexe em plano nem em Fable. Idempotente: PLAYBOOK_PROJECT_ID já gravado só é trocado com --projeto.
if (argv.includes("--verificar-telemetria")) {
  if (!env.PLAYBOOK_TELEMETRY_URL) sair(1, `Telemetria desligada nesta máquina. Ligue com: node scripts/plano-assinatura.mjs --telemetria`);
  if (process.env.PLAYBOOK_TELEMETRY_URL !== env.PLAYBOOK_TELEMETRY_URL) {
    sair(3, `Telemetria gravada em ${SETTINGS}, mas esta sessão foi aberta antes. Reinicie o Claude Code.`);
  }
  sair(0, `Telemetria ligada (${env.PLAYBOOK_TELEMETRY_URL}) · projeto ${env.PLAYBOOK_PROJECT_ID || "(sem id)"}.`);
}
if (argv.includes("--telemetria")) {
  const id = opt("--projeto") !== undefined ? opt("--projeto") : (env.PLAYBOOK_PROJECT_ID || slug(basename(process.cwd())) || "projeto");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) sair(2, `--projeto inválido: ${id}. Use minúsculas, dígitos e hífen (até 64).`);
  const antes = JSON.stringify(env);
  if (env.PLAYBOOK_TELEMETRY_URL && env.PLAYBOOK_TELEMETRY_URL !== "spool") {
    console.log(`Aviso: PLAYBOOK_TELEMETRY_URL=${env.PLAYBOOK_TELEMETRY_URL} (coletor) foi mantida; o spool local não foi imposto.`);
  } else env.PLAYBOOK_TELEMETRY_URL = "spool";
  env.PLAYBOOK_PROJECT_ID = id;
  s.env = env;
  if (JSON.stringify(env) !== antes || !existsSync(SETTINGS)) writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
  sair(0, `Telemetria ligada: ${env.PLAYBOOK_TELEMETRY_URL}, projeto ${id}. Gravado em ${SETTINGS}. Reinicie o Claude Code: o env do settings carrega no startup.`);
}

if (argv.includes("--verificar")) {
  const plano = env.PLAYBOOK_PLANO;
  if (!plano) sair(1, `Plano não declarado nesta máquina. Rode: node scripts/plano-assinatura.mjs`);
  const sre = FABLE_INCLUSO.has(plano) ? "Fable" : `Opus (${OPUS_PARA_SRE})`;
  // Só PLAYBOOK_PLANO: o Claude Code não repassa ANTHROPIC_DEFAULT_FABLE_MODEL ao shell, e quem põe o
  // Security-SRE em Opus é a chamada com `model: opus` (playbook-task.js, Orchestrator), não o alias (pendência 8).
  if (process.env.PLAYBOOK_PLANO !== plano) {
    sair(3, `Plano ${plano} gravado em ${SETTINGS}, mas esta sessão foi aberta antes (PLAYBOOK_PLANO=${process.env.PLAYBOOK_PLANO || "vazio"}). Reinicie o Claude Code.`);
  }
  sair(0, `Plano ${plano} · Security-SRE em ${sre}.`);
}

let plano, fonte;
if (opt("--plano")) {
  const declarado = opt("--plano");
  plano = SINONIMOS[declarado] || declarado;
  if (!PLANOS.includes(plano)) sair(2, `--plano inválido: ${declarado}. Use um de: ${[...PLANOS, ...Object.keys(SINONIMOS)].join(", ")}.`);
  fonte = plano === declarado ? "declarado com --plano" : `declarado com --plano ${declarado} (mesma regra do ${plano})`;
} else {
  ({ plano, fonte } = detectar());
}

const avisos = [];
env.PLAYBOOK_PLANO = plano;
if (!FABLE_INCLUSO.has(plano)) {
  if (env.ANTHROPIC_DEFAULT_FABLE_MODEL && env.ANTHROPIC_DEFAULT_FABLE_MODEL !== OPUS_PARA_SRE) {
    avisos.push(`ANTHROPIC_DEFAULT_FABLE_MODEL era ${env.ANTHROPIC_DEFAULT_FABLE_MODEL}; trocado para ${OPUS_PARA_SRE}.`);
  }
  env.ANTHROPIC_DEFAULT_FABLE_MODEL = OPUS_PARA_SRE;
} else if (env.ANTHROPIC_DEFAULT_FABLE_MODEL === OPUS_PARA_SRE) {
  delete env.ANTHROPIC_DEFAULT_FABLE_MODEL;   // valor posto por este script: o alias `fable` volta ao Fable
} else if (env.ANTHROPIC_DEFAULT_FABLE_MODEL) {
  avisos.push(`ANTHROPIC_DEFAULT_FABLE_MODEL=${env.ANTHROPIC_DEFAULT_FABLE_MODEL} não foi posto por este script e foi mantido: confira se é o que você quer.`);
}
s.env = env;
writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");

console.log(`Plano: ${plano} (${fonte})`);
console.log(`Security-SRE: ${FABLE_INCLUSO.has(plano) ? "Fable (incluído no plano ou cobrado por API)" : `Opus — ${OPUS_PARA_SRE} (no ${plano}, o Fable sai em crédito avulso)`}`);
if (fonte.startsWith("subscriptionType")) console.log("Se o plano detectado estiver errado (há relatos do CLI mostrando Max como pro), rode de novo com --plano.");
for (const a of avisos) console.log(`Aviso: ${a}`);
console.log(`Gravado em ${SETTINGS}. Reinicie as sessões do Claude Code: o env do settings carrega no startup.`);
