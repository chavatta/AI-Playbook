// telemetry-emit.mjs 0.2.1 — emissor genérico de telemetria do playbook (playbook.telemetry/v1)
// Licença: proprietária, uso interno (UNLICENSED). Arquivo gerado por build: não edite à mão.

// src/emit.ts
import { createHash, randomBytes } from "node:crypto";
import { writeSync as writeSync2 } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";

// ../event-schema/dist/src/limits.js
var EVENT_LIMITS = {
  /** Evento serializado (UTF-8, JSON compacto). Acima disso o servidor rejeita com `too_large`. */
  eventBytes: 64 * 1024,
  /** `data` serializado. */
  dataBytes: 48 * 1024,
  /** Profundidade de `data`; o nível excedente vira `"[DEPTH]"` na origem. */
  dataDepth: 6,
  /** Chaves por objeto em `data`; as excedentes são descartadas e o caminho vai para `data.truncated`. */
  keysPerObject: 100,
  /** Tamanho de chave; chave maior é descartada. */
  keyLength: 64,
  /** Itens por array em `data`, salvo limite do campo. */
  arrayItems: 50,
  /** String genérica em `data`, salvo limite do campo. */
  stringLength: 2048,
  /** Lote HTTP: eventos por lote. */
  batchEvents: 500,
  /** Lote HTTP: bytes descomprimidos. */
  batchBytes: 1024 * 1024,
  /** Payload lido do stdin pelo hook. */
  hookStdinBytes: 8 * 1024 * 1024,
  /** Entradas de `data.truncated`. */
  truncatedEntries: 20,
  /** Tamanho de cada entrada de `data.truncated`. */
  truncatedEntryLength: 128
};
var DEPTH_MARKER = "[DEPTH]";
function utf8ByteLength(text2) {
  let bytes = 0;
  for (let i = 0; i < text2.length; i++) {
    const code = text2.charCodeAt(i);
    if (code < 128)
      bytes += 1;
    else if (code < 2048)
      bytes += 2;
    else if (code >= 55296 && code <= 56319 && i + 1 < text2.length) {
      const next = text2.charCodeAt(i + 1);
      if (next >= 56320 && next <= 57343) {
        bytes += 4;
        i++;
      } else
        bytes += 3;
    } else
      bytes += 3;
  }
  return bytes;
}
function serializedByteLength(value) {
  return utf8ByteLength(JSON.stringify(value) ?? "");
}

// src/constants.ts
var EMITTER_VERSION = "0.2.1";
var BUDGET = {
  /** Prazo total padrão; `--budget-ms` só pode diminuir. */
  defaultMs: 1500,
  /** SessionEnd do Claude Code e SessionEnd/Interrupt do Codex (os hooks desses eventos dividem ~1,5 s). */
  shortMs: 1e3,
  /** Menor prazo aceito em `--budget-ms`; abaixo disso nem o stdin cabe. */
  minMs: 100,
  /** O watchdog dispara este tanto antes do prazo. */
  watchdogMarginMs: 50,
  /** Folga entre o fim da chamada de rede e o prazo. */
  networkMarginMs: 150,
  /** Teto do POST do evento ao vivo. */
  postMaxMs: 800,
  /** Sobra mínima para tentar drenar um lote depois do POST confirmado. */
  drainMinRemainingMs: 400,
  /** Espera pelo EOF do stdin sem bytes novos (rearmada a cada bloco; o teto total é a parada tardia). */
  stdinTimeoutMs: 300,
  /**
   * Máquina sem CPU (o processo só chega ao evento depois do prazo): o payload que o runtime já entregou ainda vai ao
   * spool, sem rede, até no máximo um prazo a mais (`lateStopAtMs`). Esta é a parada incondicional absoluta desse
   * caminho, em ms desde o início do processo. O `timeout` do registro (`HOOK_REGISTRATION.timeoutSeconds`) fica bem
   * acima dela: ele conta desde o `spawn`, e um processo que esperou CPU na fila não pode morrer antes desta parada.
   */
  lateHardStopMs: 2800,
  /** Abaixo disto não vale abrir conexão: o evento vai direto ao spool (sem contar como falha do coletor). */
  minPostMs: 200,
  /**
   * Timeout de POST menor que isto não abre o disjuntor: quem ficou sem tempo foi o processo (máquina saturada), e
   * isso não é evidência de coletor fora. Falha local (sem tempo para tentar, módulo de rede que não carregou) também
   * não abre, em qualquer prazo. Erro de rede e 5xx/408/429 abrem sempre.
   */
  breakerMinTimeoutMs: 400
};
var PAYLOAD = {
  stdinMaxBytes: EVENT_LIMITS.hookStdinBytes,
  batchEvents: EVENT_LIMITS.batchEvents,
  batchBytes: EVENT_LIMITS.batchBytes,
  /** Uma linha de spool é um evento serializado (≤ 64 KiB); com folga para a quebra de linha. */
  maxLineBytes: EVENT_LIMITS.eventBytes + 1024,
  /** Corpo de resposta do coletor lido no máximo. */
  responseMaxBytes: 64 * 1024,
  /** Arquivo pequeno lido pela detecção de projeto e de task (`.git`, `HEAD`, `config`, estado). */
  smallFileMaxBytes: 64 * 1024,
  /** Cauda do transcript do subagente lida para achar o ponteiro de handoff. */
  transcriptTailBytes: 64 * 1024,
  /**
   * Teto de cada texto livre do agente (comando, padrão de busca, caminho, descrição, prévia) antes de qualquer
   * trabalho proporcional ao tamanho: só a classificação do shell custa ~0,3 ms por KiB (2 MiB = 646 ms, medido), a
   * redação também cresce com o texto, e um comando de 8 MiB passaria da parada interna
   * antes do spool. Fica acima de `EVENT_LIMITS.dataBytes` (48 KiB), o maior texto que o contrato guarda, e a folga de 16 KiB é maior que qualquer segredo que a redação reconhece: o corte do contrato
   * continua decidindo o texto final (com a marca `…[+N]`) e um segredo partido aqui nunca chega à parte guardada.
   */
  freeTextMaxChars: 64 * 1024,
  /**
   * Teto estrutural do payload, conferido no texto antes do `JSON.parse`: aberturas de objeto e de array e vírgulas fora
   * de string (cerca de um por valor). O custo do parse cresce com o número de valores, não com os bytes, e é síncrono,
   * fora do alcance do watchdog: 300 mil chaves num `tool_input` custaram de 1,9 s a 6,6 s só no parse (load 26 em 6
   * núcleos), e o `timeout: 3` do registro de então matava o processo sem spool. Um array de 50 mil objetos, cada um
   * com uma chave diferente (o pior caso medido por valor), custou 1,5 s. Acima do teto o payload não é lido, e o evento vira
   * `error{scope:'hook', code:'payload_too_complex'}`, para a supressão não ser silenciosa.
   */
  stdinMaxNodes: 5e4,
  /**
   * Valores copiados do input de ferramenta (a projeção que a classificação e o alvo leem, e a prévia do `verbose`):
   * a cópia fica proporcional a este teto, não ao número de chaves que o agente ou um servidor MCP mandou.
   */
  inputNodesMax: 4096,
  /** Valores medidos em `output_bytes`: acima disso a medida é omitida (serializar tudo seria proporcional aos valores). */
  measureNodesMax: 1e4
};
var SPOOL = {
  /** Acima disso descarta `tool.pre` e `progress.report`. */
  softLimitBytes: 20 * 1024 * 1024,
  /** Acima disso descarta tudo e grava uma única linha `error{code:'spool_full'}`. */
  hardLimitBytes: 50 * 1024 * 1024,
  /** Lock mais velho que isto é obsoleto. */
  lockStaleMs: 3e4,
  /** `.draining-*` só é apagado quando está parado há mais que isto (um append lento pode estar em curso). */
  drainingSettleMs: 5e3,
  /** Tipos descartados acima do limite brando. */
  softDropTypes: ["tool.pre", "progress.report"]
};
var BREAKER = {
  baseWindowMs: 15e3,
  maxWindowMs: 5 * 6e4,
  /** Teto para `Retry-After`: um cabeçalho absurdo não silencia a rede por dias. */
  maxRetryAfterMs: 60 * 6e4
};
var DEBUG_LOG = {
  rotateBytes: 1024 * 1024
};
var STATE_DIR_NAME = "playbook-telemetry";

// ../core/dist/src/identity/hex.js
function toHex(bytes) {
  let out = "";
  for (const byte of bytes)
    out += byte.toString(16).padStart(2, "0");
  return out;
}

// contract-snapshot:primitives
var CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var ULID_MAX_TIME_MS = 281474976710655;
var PROJECT_REMOTE_PATTERN = /^(?:[a-z0-9.-]+\/[a-z0-9._~/-]+|local:[0-9a-f]{16})$/;
var RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/;
var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ../core/dist/src/ids/ulid.js
var TIME_CHARS = 10;
var RANDOM_CHARS = 16;
var RANDOM_BYTES = 10;
var UlidError = class extends Error {
  name = "UlidError";
};
function encodeUlidTime(timeMs) {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > ULID_MAX_TIME_MS) {
    throw new UlidError(`tempo fora do intervalo do ULID: ${timeMs}`);
  }
  let rest = timeMs;
  let out = "";
  for (let i = 0; i < TIME_CHARS; i++) {
    out = CROCKFORD_ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}
function encodeCrockfordInteger(bytes, length) {
  let value = 0n;
  for (const byte of bytes)
    value = value << 8n | BigInt(byte);
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD_ALPHABET.charAt(Number(value & 31n)) + out;
    value >>= 5n;
  }
  if (value !== 0n)
    throw new UlidError(`valor não cabe em ${length} caracteres Crockford`);
  return out;
}
function checkRandom(bytes) {
  if (bytes.length < RANDOM_BYTES) {
    throw new UlidError(`a fonte aleatória devolveu ${bytes.length} bytes; são necessários ${RANDOM_BYTES}`);
  }
  return bytes.slice(0, RANDOM_BYTES);
}
function incrementRandom(bytes) {
  const next = bytes.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const byte = next[i] ?? 0;
    if (byte < 255) {
      next[i] = byte + 1;
      return next;
    }
    next[i] = 0;
  }
  return null;
}
function createUlidFactory(options) {
  let lastTime = -1;
  let lastRandom = null;
  return {
    next(timeMs) {
      encodeUlidTime(timeMs);
      let time = timeMs;
      let random;
      if (lastRandom !== null && timeMs <= lastTime && timeMs >= lastTime - 1) {
        const incremented = incrementRandom(lastRandom);
        if (incremented === null) {
          time = lastTime + 1;
          random = checkRandom(options.random(RANDOM_BYTES));
        } else {
          time = lastTime;
          random = incremented;
        }
      } else {
        random = checkRandom(options.random(RANDOM_BYTES));
      }
      lastTime = time;
      lastRandom = random;
      return encodeUlidTime(time) + encodeCrockfordInteger(random, RANDOM_CHARS);
    }
  };
}

// src/breaker.ts
import { join as join2 } from "node:path";

// src/files.ts
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
var NOFOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
var NONBLOCK = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
function ensurePrivateDir(path, options) {
  try {
    if (!makeDirs(path)) return false;
    let stat = lstatSync(path);
    if (!stat.isDirectory()) return false;
    if (options.uid === null) return true;
    if (stat.uid !== options.uid) return false;
    if ((stat.mode & 63) !== 0) {
      chmodSync(path, 448);
      stat = lstatSync(path);
    }
    return stat.isDirectory() && (stat.mode & 63) === 0;
  } catch {
    return false;
  }
}
function stateDirCandidates(options) {
  const candidates = [];
  const runtimeDir = options.runtimeDir;
  if (runtimeDir !== void 0 && isAbsolute(runtimeDir)) {
    candidates.push({ path: join(runtimeDir, options.name), parentMustExist: true });
  }
  const suffix = options.uid === null ? "" : `-${options.uid}`;
  candidates.push({ path: join(options.tmpDir, `${options.name}${suffix}`), parentMustExist: false });
  return candidates;
}
function resolveStateDir(options) {
  for (const { path, parentMustExist } of stateDirCandidates(options)) {
    if (parentMustExist && !isDirectory(dirname(path))) continue;
    if (ensurePrivateDir(path, { uid: options.uid })) return path;
  }
  return null;
}
function ensureDir(path) {
  try {
    return makeDirs(path) && lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
var MAX_DIR_DEPTH = 64;
function errorCode(error) {
  return typeof error === "object" && error !== null ? error.code : void 0;
}
function makeDirs(path) {
  const missing = [];
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current || missing.length >= MAX_DIR_DEPTH) return false;
    missing.push(current);
    current = parent;
  }
  for (const dir of missing.reverse()) {
    try {
      mkdirSync(dir, { mode: 448 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return false;
    }
  }
  return true;
}
function resolveRealDir(path) {
  const missing = [];
  let current = path;
  for (let depth = 0; depth <= MAX_DIR_DEPTH; depth++) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch (error) {
      if (errorCode(error) !== "ENOENT" || lstatQuietly(current) !== null) return null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    missing.push(basename(current));
    current = parent;
  }
  return null;
}
function lstatQuietly(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function isRealDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
function soleFile(stat) {
  return stat.isFile() && stat.nlink === 1;
}
function fileSize(path) {
  try {
    const stat = lstatSync(path);
    return soleFile(stat) ? stat.size : null;
  } catch {
    return null;
  }
}
function identityOf(stat) {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}
function fileIdentity(path) {
  try {
    const stat = lstatSync(path);
    return soleFile(stat) ? identityOf(stat) : null;
  } catch {
    return null;
  }
}
function entryIdentity(path) {
  try {
    const stat = lstatSync(path);
    return { ...identityOf(stat), regular: stat.isFile() };
  } catch {
    return null;
  }
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
function soleFileOrAbsent(path) {
  try {
    return soleFile(lstatSync(path));
  } catch (error) {
    return error.code === "ENOENT";
  }
}
function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
}
function appendExclusive(path, content) {
  if (!soleFileOrAbsent(path)) return null;
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW | NONBLOCK, 384);
    const stat = fstatSync(fd);
    if (!soleFile(stat)) return null;
    const text2 = content(stat.size, identityOf(stat));
    if (text2 === null) return "refused";
    if (text2 !== "") writeAll(fd, Buffer.from(text2, "utf8"));
    return { sizeBefore: stat.size };
  } catch {
    return null;
  } finally {
    if (fd !== void 0) closeQuietly(fd);
  }
}
function closeQuietly(fd) {
  try {
    closeSync(fd);
  } catch {
  }
}
function readRange(path, offset, maxBytes) {
  if (fileSize(path) === null) return null;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const stat = fstatSync(fd);
    if (!soleFile(stat)) return null;
    const length = Math.max(0, Math.min(maxBytes, stat.size - offset));
    const data = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, data, read, length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    return { data: data.subarray(0, read), size: stat.size, identity: identityOf(stat) };
  } catch {
    return null;
  } finally {
    if (fd !== void 0) closeQuietly(fd);
  }
}
function readSmallText(path, maxBytes) {
  const range = readRange(path, 0, maxBytes);
  if (range === null || range.size > maxBytes) return null;
  return range.data.toString("utf8");
}
function readTail(path, maxBytes) {
  const size = fileSize(path);
  if (size === null) return null;
  const range = readRange(path, Math.max(0, size - maxBytes), maxBytes);
  return range === null ? null : range.data.toString("utf8");
}
function writeAtomic(path, content, uniqueSuffix) {
  const temp = `${path}.tmp-${uniqueSuffix}`;
  let fd;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 384);
    writeAll(fd, Buffer.from(content, "utf8"));
    closeSync(fd);
    fd = void 0;
    renameSync(temp, path);
    return true;
  } catch {
    if (fd !== void 0) closeQuietly(fd);
    removeQuietly(temp);
    return false;
  }
}
function createExclusive(path, content) {
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 384);
    writeAll(fd, Buffer.from(content, "utf8"));
    return true;
  } catch (error) {
    return error.code === "EEXIST" ? "exists" : false;
  } finally {
    if (fd !== void 0) closeQuietly(fd);
  }
}
function restoreWithoutOverwrite(from, to) {
  try {
    linkSync(from, to);
  } catch {
  }
  removeQuietly(from);
}
function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
  }
}
function renameQuietly(from, to) {
  try {
    renameSync(from, to);
    return true;
  } catch {
    return false;
  }
}

// src/values.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value) {
  if (typeof value !== "string") return void 0;
  return value.trim() === "" ? void 0 : value;
}
function firstText(record, keys) {
  for (const key of keys) {
    const value = text(record[key]);
    if (value !== void 0) return value;
  }
  return void 0;
}
function count(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return void 0;
  const floored = Math.floor(value);
  return Number.isSafeInteger(floored) ? floored : void 0;
}
function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : void 0;
}
function bool(value) {
  return typeof value === "boolean" ? value : void 0;
}
var PRINTABLE = /^[\x21-\x7e]+$/;
function printable(value, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return void 0;
  return PRINTABLE.test(value) ? value : void 0;
}
function cutText(value, max) {
  if (value.length <= max) return value;
  const cut = value.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 55296 && last <= 56319 ? cut.slice(0, -1) : cut;
}
function clip(value, max) {
  const content = text(value);
  return content === void 0 ? void 0 : cutText(content, max);
}
function freeText(value) {
  return clip(value, PAYLOAD.freeTextMaxChars);
}
function withinNodes(value, maxNodes) {
  let nodes = 0;
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes++;
    if (nodes > maxNodes) return false;
    if (typeof current !== "object" || current === null) continue;
    const children = Array.isArray(current) ? current : Object.values(current);
    if (nodes + stack.length + children.length > maxNodes) return false;
    for (const child of children) stack.push(child);
  }
  return true;
}
function boundedJson(value, maxNodes = PAYLOAD.measureNodesMax) {
  if (!withinNodes(value, maxNodes)) return void 0;
  return JSON.stringify(value);
}
function byteLength(value, maxNodes = PAYLOAD.measureNodesMax) {
  if (value === void 0) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  const serialized = boundedJson(value, maxNodes);
  return serialized === void 0 ? void 0 : Buffer.byteLength(serialized, "utf8");
}
function compact(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) if (value !== void 0) out[key] = value;
  return out;
}

// src/breaker.ts
var CLOSED_BREAKER = Object.freeze({ open_until_ms: 0, failures: 0 });
function breakerPath(stateDir, url, sha256Hex) {
  return join2(stateDir, `breaker-${sha256Hex(url).slice(0, 12)}.json`);
}
function isBreakerOpen(state, nowMs) {
  return state.open_until_ms > nowMs;
}
function breakerWindowMs(failures) {
  const exponent = Math.max(0, Math.min(failures, 32) - 1);
  return Math.min(BREAKER.baseWindowMs * 2 ** exponent, BREAKER.maxWindowMs);
}
function breakerAfterFailure(state, nowMs, retryAfterMs) {
  const failures = Math.min(state.failures + 1, 1e3);
  const window = retryAfterMs === void 0 ? breakerWindowMs(failures) : Math.min(Math.max(0, retryAfterMs), BREAKER.maxRetryAfterMs);
  return { open_until_ms: nowMs + window, failures };
}
function readBreaker(path) {
  const content = readSmallText(path, PAYLOAD.smallFileMaxBytes);
  if (content === null) return CLOSED_BREAKER;
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return CLOSED_BREAKER;
    return { open_until_ms: count(parsed.open_until_ms) ?? 0, failures: count(parsed.failures) ?? 0 };
  } catch {
    return CLOSED_BREAKER;
  }
}
function writeBreaker(path, state, uniqueSuffix) {
  return writeAtomic(path, JSON.stringify(state), uniqueSuffix);
}

// src/config.ts
import { isAbsolute as isAbsolute2, normalize } from "node:path";

// ../event-schema/dist/src/enums.js
var POINTER_STATUS = ["completed", "blocked", "needs_review"];
var HANDOFF_POINTER_STATUS = [
  "completed",
  "blocked",
  "needs_review",
  "checkpoint"
];
var TASK_SOURCES = ["env", "branch", "path_write", "sticky", "path_read", "portal", "file"];
var DETAIL_LEVELS = ["minimal", "standard", "verbose"];

// src/config.ts
var RUNTIMES = ["claude-code", "codex", "cursor", "agy"];
function flagValue(argv, name) {
  const prefix = `--${name}=`;
  let found;
  for (const arg of argv) if (arg.startsWith(prefix)) found = arg.slice(prefix.length);
  return found;
}
function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed === void 0 || trimmed === "" ? void 0 : trimmed;
}
function parseRuntime(value) {
  return RUNTIMES.includes(value ?? "") ? value : void 0;
}
function parseDetail(value) {
  return DETAIL_LEVELS.includes(value ?? "") ? value : void 0;
}
function parseBudget(value) {
  if (value === void 0 || !/^\d{1,6}$/.test(value)) return BUDGET.defaultMs;
  return Math.min(BUDGET.defaultMs, Math.max(BUDGET.minMs, Number(value)));
}
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "[::1]"]);
function isLoopback(hostname2) {
  return LOOPBACK_HOSTS.has(hostname2) || /^127(?:\.\d{1,3}){3}$/.test(hostname2);
}
function parseCollector(raw) {
  const value = raw?.trim() ?? "";
  if (value === "") return { kind: "noop" };
  if (value === "spool") return { kind: "spool", reason: "configured" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { kind: "spool", reason: "invalid_url" };
  }
  if (url.username !== "" || url.password !== "") return { kind: "spool", reason: "invalid_url" };
  if (url.protocol === "https:") return { kind: "http", url };
  if (url.protocol === "http:") {
    return isLoopback(url.hostname) ? { kind: "http", url } : { kind: "spool", reason: "insecure_http" };
  }
  return { kind: "spool", reason: "invalid_url" };
}
function parseToken(value) {
  const token = nonEmpty(value);
  return token !== void 0 && /^[\x21-\x7e]{1,1024}$/.test(token) ? token : void 0;
}
function parseRunId(value) {
  const id = nonEmpty(value);
  return id !== void 0 && RUN_ID_PATTERN.test(id) ? id : void 0;
}
function parseSlug(value) {
  const slug = nonEmpty(value);
  return slug !== void 0 && SLUG_PATTERN.test(slug) ? slug : void 0;
}
function hasControlChar(text2) {
  for (let index = 0; index < text2.length; index++) {
    const code = text2.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function parseRunSpool(dirValue, runId) {
  if (dirValue === void 0) return { kind: "none" };
  const validDir = dirValue !== "" && dirValue === dirValue.trim() && isAbsolute2(dirValue) && normalize(dirValue) === dirValue && !hasControlChar(dirValue);
  return validDir && runId !== void 0 ? { kind: "run", dir: dirValue, runId } : { kind: "invalid" };
}
var BUS_SERVER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)*$/;
var BUS_SERVER_MAX = 64;
function parseBusServer(value) {
  const name = nonEmpty(value);
  return name !== void 0 && name.length <= BUS_SERVER_MAX && BUS_SERVER_PATTERN.test(name) ? name : void 0;
}
function parseScope(value, runId) {
  if (value === "all" || value === "complement") return value;
  return runId === void 0 ? "all" : "complement";
}
function readConfig(argv, env) {
  const runIdRaw = nonEmpty(env.PLAYBOOK_RUN_ID);
  const runId = parseRunId(runIdRaw);
  const probeLog = nonEmpty(flagValue(argv, "probe-log"));
  return {
    runtimeFlag: parseRuntime(flagValue(argv, "runtime")),
    eventFlag: nonEmpty(flagValue(argv, "event")),
    detail: parseDetail(flagValue(argv, "detail")) ?? parseDetail(nonEmpty(env.PLAYBOOK_TELEMETRY_DETAIL)) ?? "standard",
    projectId: parseSlug(flagValue(argv, "project")) ?? parseSlug(env.PLAYBOOK_PROJECT_ID),
    budgetMs: parseBudget(flagValue(argv, "budget-ms")),
    probeLog,
    collector: parseCollector(env.PLAYBOOK_TELEMETRY_URL),
    token: parseToken(env.PLAYBOOK_TELEMETRY_TOKEN),
    taskIdEnv: nonEmpty(env.PLAYBOOK_TASK_ID),
    runId,
    agentRole: nonEmpty(env.PLAYBOOK_AGENT_ROLE)?.slice(0, 64),
    // O escopo segue a presença da variável, mesmo com valor malformado: é uma execução orquestrada.
    scope: parseScope(nonEmpty(env.PLAYBOOK_TELEMETRY_SCOPE), runIdRaw),
    debug: env.PLAYBOOK_TELEMETRY_DEBUG === "1",
    runSpool: parseRunSpool(env.PLAYBOOK_TELEMETRY_SPOOL_DIR, runId),
    busServer: parseBusServer(env.PLAYBOOK_TELEMETRY_BUS_SERVER),
    cursorVersion: nonEmpty(env.CURSOR_VERSION),
    claudeProjectDir: nonEmpty(env.CLAUDE_PROJECT_DIR),
    cursorProjectDir: nonEmpty(env.CURSOR_PROJECT_DIR)
  };
}

// src/context.ts
import { lstatSync as lstatSync2, realpathSync as realpathSync2, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute3, join as join3, resolve } from "node:path";

// ../core/dist/src/identity/path.js
function toPosixPath(path) {
  const slashed = path.replaceAll("\\", "/");
  return /^[A-Za-z]:\//.test(slashed) || /^[A-Za-z]:$/.test(slashed) ? slashed.charAt(0).toLowerCase() + slashed.slice(1) : slashed;
}
function isAbsolutePath(path) {
  const posix2 = toPosixPath(path);
  return posix2.startsWith("/") || /^[a-z]:\//.test(posix2);
}
function normalizePath(path) {
  const posix2 = toPosixPath(path);
  const drive = /^[a-z]:/.exec(posix2)?.[0] ?? "";
  const rest = posix2.slice(drive.length);
  const absolute = rest.startsWith("/");
  const out = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".")
      continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..")
        out.pop();
      else if (!absolute)
        out.push("..");
      continue;
    }
    out.push(segment);
  }
  const body = out.join("/");
  if (absolute)
    return `${drive}/${body}`;
  return drive + (body === "" ? "." : body);
}
function joinPath(base, path) {
  return isAbsolutePath(path) ? normalizePath(path) : normalizePath(`${toPosixPath(base)}/${path}`);
}
function dirnamePath(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  if (index < 0)
    return ".";
  if (index === 0)
    return "/";
  if (/^[a-z]:$/.test(normalized.slice(0, index)))
    return `${normalized.slice(0, index)}/`;
  return normalized.slice(0, index);
}
function basenamePath(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? normalized : normalized.slice(index + 1);
}
function isSameOrInside(path, parent) {
  if (path === parent)
    return true;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return path.startsWith(prefix);
}
function relativeInside(path, parent) {
  const child = normalizePath(path);
  const base = normalizePath(parent);
  if (child === base)
    return ".";
  if (!isSameOrInside(child, base))
    return null;
  return child.slice(base.endsWith("/") ? base.length : base.length + 1);
}

// ../core/dist/src/identity/remote.js
var SECTION_LINE = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*(?:[;#].*)?$/;
var KEY_LINE = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/;
function parseValue(raw) {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (char === "\\" && i + 1 < raw.length) {
      const next = raw.charAt(++i);
      out += next === "n" ? "\n" : next === "t" ? "	" : next;
    } else if (char === '"')
      quoted = !quoted;
    else if ((char === ";" || char === "#") && !quoted)
      break;
    else
      out += char;
  }
  return out.trim();
}
function parseGitConfig(text2) {
  const entries = [];
  let section = null;
  let subsection = null;
  for (const line of text2.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
    const header = SECTION_LINE.exec(line);
    if (header !== null) {
      section = (header[1] ?? "").toLowerCase();
      subsection = header[2] === void 0 ? null : header[2].replace(/\\(.)/g, "$1");
      continue;
    }
    const pair = KEY_LINE.exec(line);
    if (pair === null || section === null)
      continue;
    entries.push({ section, subsection, key: (pair[1] ?? "").toLowerCase(), value: parseValue(pair[2] ?? "true") });
  }
  return entries;
}
function pickRemote(configText) {
  const urls = /* @__PURE__ */ new Map();
  for (const entry2 of parseGitConfig(configText)) {
    if (entry2.section === "remote" && entry2.subsection !== null && entry2.key === "url" && !urls.has(entry2.subsection)) {
      urls.set(entry2.subsection, entry2.value);
    }
  }
  const origin = urls.get("origin");
  if (origin !== void 0)
    return origin;
  const first = [...urls.keys()].sort()[0];
  return first === void 0 ? void 0 : urls.get(first);
}
var SCP_FORM = /^([^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;
var URL_FORM = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;
var WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
function localRemote(path, sha256) {
  return `local:${toHex(sha256(normalizePath(path))).slice(0, 16)}`;
}
function hostPath(host, path) {
  const cleanPath = path.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").replace(/\/+$/g, "");
  const result = `${host}/${cleanPath}`.toLowerCase();
  return host !== "" && cleanPath !== "" && PROJECT_REMOTE_PATTERN.test(result) ? result : null;
}
function normalizeRemote(url, sha256) {
  let value = url.trim();
  if (value.toLowerCase().startsWith("git+"))
    value = value.slice(4);
  if (value === "")
    return null;
  if (WINDOWS_DRIVE.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return localRemote(value, sha256);
  }
  const asUrl = URL_FORM.exec(value);
  if (asUrl !== null) {
    const scheme = (asUrl[1] ?? "").toLowerCase();
    const authority = asUrl[2] ?? "";
    const path = decodeSafely(asUrl[3] ?? "");
    if (scheme === "file")
      return localRemote(authority === "" || authority === "localhost" ? path : `//${authority}${path}`, sha256);
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    const host = hostPort.startsWith("[") ? hostPort.slice(0, hostPort.indexOf("]") + 1) : hostPort.split(":")[0] ?? "";
    return hostPath(host, path);
  }
  const scp = SCP_FORM.exec(value);
  if (scp !== null)
    return hostPath(scp[2] ?? "", scp[3] ?? "");
  return localRemote(value, sha256);
}
function decodeSafely(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// ../core/dist/src/identity/root.js
var FIND_ROOT_MAX_LEVELS = 40;
function findRoot(cwd, fs, maxLevels = FIND_ROOT_MAX_LEVELS) {
  const start = normalizePath(cwd);
  let dir = start;
  for (let level = 0; level <= maxLevels; level++) {
    const kind = fs.entryKind(joinPath(dir, ".git"));
    if (kind !== null)
      return { root: dir, gitKind: kind };
    const parent = dirnamePath(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return { root: start, gitKind: null };
}
function readGit(root, fs) {
  const base = normalizePath(root);
  const dotGit = joinPath(base, ".git");
  const kind = fs.entryKind(dotGit);
  let gitDir;
  if (kind === "dir")
    gitDir = dotGit;
  else if (kind === "file") {
    const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readText(dotGit) ?? "");
    if (pointer?.[1] === void 0)
      return null;
    gitDir = isAbsolutePath(pointer[1]) ? normalizePath(pointer[1]) : joinPath(base, pointer[1]);
  } else
    return null;
  const commonDirText = fs.readText(joinPath(gitDir, "commondir"))?.trim();
  const commonDir = commonDirText === void 0 || commonDirText === "" ? gitDir : isAbsolutePath(commonDirText) ? normalizePath(commonDirText) : joinPath(gitDir, commonDirText);
  const config = fs.readText(joinPath(commonDir, "config"));
  const head = fs.readText(joinPath(gitDir, "HEAD"));
  return { gitDir, commonDir, config, head, remoteUrl: config === null ? void 0 : pickRemote(config) };
}
function branchFromHead(head) {
  const match = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head ?? "");
  return match?.[1] ?? null;
}
function canonicalRootPath(realPath) {
  return normalizePath(realPath);
}
function rootHash(realPath, sha256) {
  return toHex(sha256(canonicalRootPath(realPath)));
}

// ../core/dist/src/taskid/detect.js
var CANONICAL_TASK_ID = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/;
var LEGACY_TASK_ID = /^T-\d{3,}(?:-[a-z0-9][a-z0-9-]*)?$/;
var GENERIC_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var TASK_MENTION = /(?:^|[\\/\s'"=:])tasks[\\/]([A-Za-z0-9][A-Za-z0-9._-]{0,127})[\\/]/;
var STICKY_TTL_MS = 12 * 60 * 60 * 1e3;
function isExcluded(id) {
  return id === "_TEMPLATE" || id.startsWith(".") || id.startsWith("_");
}
function taskIdFormat(id) {
  if (isExcluded(id))
    return null;
  if (CANONICAL_TASK_ID.test(id))
    return "canonical";
  if (LEGACY_TASK_ID.test(id))
    return "tnnn";
  if (GENERIC_TASK_ID.test(id))
    return "other";
  return null;
}
function acceptTaskId(id, briefExists2) {
  const format = taskIdFormat(id);
  if (format === null)
    return false;
  return format !== "other" || briefExists2(id);
}
function taskIdsMentioned(text2, context) {
  const found = /* @__PURE__ */ new Set();
  const root = normalizePath(context.root);
  const tasksDir = joinPath(root, "tasks");
  const posixText = toPosixPath(text2);
  for (const match of posixText.matchAll(new RegExp(TASK_MENTION.source, "g"))) {
    const id = match[1];
    if (id === void 0)
      continue;
    const start = (match.index ?? 0) + match[0].indexOf("tasks");
    const prefix = pathPrefixBefore(posixText, start);
    const base = prefix === "" ? context.cwd : isAbsolutePath(prefix) ? prefix : joinPath(context.cwd, prefix);
    if (normalizePath(joinPath(base, "tasks")) !== tasksDir)
      continue;
    if (acceptTaskId(id, context.briefExists))
      found.add(id);
  }
  return found;
}
function pathPrefixBefore(text2, tasksIndex) {
  let start = tasksIndex;
  while (start > 0 && !/[\s'"=`;|&<>(),]/.test(text2.charAt(start - 1)))
    start--;
  const prefix = text2.slice(start, tasksIndex);
  if (/^[a-z]:\//i.test(prefix))
    return prefix;
  const colon = prefix.lastIndexOf(":");
  return colon >= 0 ? prefix.slice(colon + 1) : prefix;
}
function uniqueMention(texts, context) {
  const ids = /* @__PURE__ */ new Set();
  for (const text2 of texts)
    for (const id of taskIdsMentioned(text2, context))
      ids.add(id);
  return ids.size === 1 ? [...ids][0] ?? null : null;
}
function detectTaskId(input) {
  const env = input.envTaskId?.trim();
  if (env !== void 0 && env !== "" && acceptTaskId(env, input.briefExists)) {
    return { task_id: env, task_source: "env", updatesSticky: true };
  }
  const branch = branchFromHead(input.head ?? null);
  const branchId = branch?.startsWith("task/") ? branch.slice("task/".length) : null;
  if (branchId !== null && acceptTaskId(branchId, input.briefExists)) {
    return { task_id: branchId, task_source: "branch", updatesSticky: true };
  }
  const written = uniqueMention(input.writePaths ?? [], input);
  if (written !== null)
    return { task_id: written, task_source: "path_write", updatesSticky: true };
  const sticky = input.sticky;
  if (sticky !== null && sticky !== void 0 && input.nowMs - sticky.ts >= 0 && input.nowMs - sticky.ts <= STICKY_TTL_MS && acceptTaskId(sticky.task_id, input.briefExists)) {
    return { task_id: sticky.task_id, task_source: "sticky", updatesSticky: false };
  }
  const mentioned = uniqueMention(input.readMentions ?? [], input);
  if (mentioned !== null)
    return { task_id: mentioned, task_source: "path_read", updatesSticky: false };
  return null;
}
function stickyStateFileName(runtime, sessionId, sha256) {
  return `${toHex(sha256(`${runtime}${sessionId}`)).slice(0, 16)}.json`;
}

// src/context.ts
var nodeGitFs = {
  entryKind(path) {
    try {
      const stat = lstatSync2(path);
      if (stat.isDirectory()) return "dir";
      return stat.isFile() ? "file" : null;
    } catch {
      return null;
    }
  },
  readText(path) {
    return readSmallText(path, PAYLOAD.smallFileMaxBytes);
  }
};
function realRoot(root) {
  try {
    return realpathSync2.native(root);
  } catch {
    return root;
  }
}
function resolveProject(cwd, sha256, fs = nodeGitFs) {
  const start = isAbsolute3(cwd) ? cwd : resolve(cwd);
  const { root } = findRoot(start, fs);
  const git = readGit(root, fs);
  const remote = git?.remoteUrl === void 0 ? void 0 : normalizeRemote(git.remoteUrl, sha256) ?? void 0;
  return { root, rootHash: rootHash(realRoot(root), sha256), remote, head: git?.head ?? null };
}
function briefExists(root) {
  return (taskId) => {
    if (!GENERIC_TASK_ID.test(taskId)) return false;
    try {
      return statSync2(join3(root, "tasks", taskId, "brief.md")).isFile();
    } catch {
      return false;
    }
  };
}
function stickyPath(input) {
  if (input.stateDir === null || input.sessionId === void 0) return null;
  const dir = join3(input.stateDir, "state");
  if (!ensurePrivateDir(dir, { uid: input.uid })) return null;
  return join3(dir, stickyStateFileName(input.runtime, input.sessionId, input.sha256));
}
function isTaskSource(value) {
  return typeof value === "string" && TASK_SOURCES.includes(value);
}
function readSticky(path) {
  if (path === null) return null;
  const content = readSmallText(path, PAYLOAD.smallFileMaxBytes);
  if (content === null) return null;
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return null;
    const taskId = text(parsed.task_id);
    const ts = count(parsed.ts);
    const source = parsed.source;
    if (taskId === void 0 || ts === void 0 || !isTaskSource(source)) return null;
    return { task_id: taskId, ts, source };
  } catch {
    return null;
  }
}
function detectTask(input) {
  const sticky = stickyPath(input);
  const detection = detectTaskId({
    root: input.project.root,
    cwd: input.cwd,
    briefExists: briefExists(input.project.root),
    envTaskId: input.envTaskId,
    head: input.project.head,
    writePaths: input.tool?.writePaths,
    readMentions: input.tool?.mentions,
    sticky: readSticky(sticky),
    nowMs: input.nowMs
  });
  if (detection === null) return null;
  if (detection.updatesSticky && sticky !== null) {
    const state = { task_id: detection.task_id, source: detection.task_source, ts: input.nowMs };
    writeAtomic(sticky, JSON.stringify(state), input.uniqueSuffix);
  }
  return { taskId: detection.task_id, source: detection.task_source };
}

// src/debug.ts
import { join as join4 } from "node:path";

// ../core/dist/src/redact/json.js
var CYCLE_MARKER = "[CYCLE]";
var MAX_VISIT_DEPTH = 64;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function setEntry(record, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    record[key] = value;
  }
}
function uniqueKey(record, key) {
  if (!Object.hasOwn(record, key))
    return key;
  let suffix = 2;
  while (Object.hasOwn(record, `${key}#${suffix}`))
    suffix++;
  return `${key}#${suffix}`;
}
function copyJson(value, keep = () => true) {
  const ancestors = /* @__PURE__ */ new WeakSet();
  const visit = (node, depth) => {
    if (typeof node !== "object" || node === null)
      return node;
    if (depth > MAX_VISIT_DEPTH)
      return DEPTH_MARKER;
    if (ancestors.has(node))
      return CYCLE_MARKER;
    ancestors.add(node);
    let out;
    if (Array.isArray(node)) {
      out = node.map((item) => visit(item, depth + 1));
    } else {
      const record = {};
      for (const [key, child] of Object.entries(node)) {
        if (keep(key, child))
          setEntry(record, key, visit(child, depth + 1));
      }
      out = record;
    }
    ancestors.delete(node);
    return out;
  };
  return visit(value, 0);
}

// ../core/dist/src/redact/keys.js
var UNTRUSTED_SUBTREES = /* @__PURE__ */ new Set([
  "tool_input",
  "tool_response",
  "arguments",
  "parameters",
  "args",
  "env",
  "headers",
  "input"
]);
var SECRET_WORDS = /* @__PURE__ */ new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "bearer"
]);
var SECRET_JOINED = [
  "apikey",
  "accesskey",
  "privatekey",
  "clientsecret",
  "secretkey",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "sessiontoken"
];
function keyWords(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ").split(/[\s_.-]+/).filter((word) => word !== "").map((word) => word.toLowerCase());
}
function isSecretKey(key) {
  const words = keyWords(key);
  if (words.some((word) => SECRET_WORDS.has(word)))
    return true;
  const joined = words.join("");
  return SECRET_JOINED.some((fragment) => joined.includes(fragment));
}
var NEVER_EXPORTED_KEYS = /* @__PURE__ */ new Set([
  "content",
  "fileText",
  "old_string",
  "new_string",
  "oldString",
  "newString",
  "originalFile",
  "structuredPatch",
  "tool_response",
  "tool_output",
  "aggregated_output",
  "output",
  "stdout",
  "stderr",
  "result_json",
  "thinking",
  "signature",
  "prompt_snapshot",
  "session_context",
  "last-prompt",
  "bridge-session",
  "transcript_path",
  "agent_transcript_path",
  "transcriptPath",
  "artifactDirectoryPath",
  "log_uri",
  "workspace_uris",
  "scratchpad_dir",
  "memory_paths",
  "messaging_socket_path",
  "user_email",
  "CURSOR_USER_EMAIL",
  "ownerAccountUuid",
  "organizationUuid",
  "oauthAccount"
]);

// ../core/dist/src/redact/checks.js
function digitsOf(text2) {
  return [...text2].map((char) => char.charCodeAt(0) - 48);
}
function allEqual(digits) {
  return digits.every((digit) => digit === digits[0]);
}
function cpfCheckDigitsValid(text2) {
  if (!/^[0-9]{11}$/.test(text2))
    return false;
  const digits = digitsOf(text2);
  if (allEqual(digits))
    return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i++)
      sum += (digits[i] ?? 0) * (length + 1 - i);
    const remainder = sum * 10 % 11;
    if ((remainder === 10 ? 0 : remainder) !== digits[length])
      return false;
  }
  return true;
}
var CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
function cnpjCheckDigitsValid(text2) {
  if (!/^[0-9]{14}$/.test(text2))
    return false;
  const digits = digitsOf(text2);
  if (allEqual(digits))
    return false;
  for (const length of [12, 13]) {
    const weights = CNPJ_WEIGHTS.slice(CNPJ_WEIGHTS.length - length);
    let sum = 0;
    for (let i = 0; i < length; i++)
      sum += (digits[i] ?? 0) * (weights[i] ?? 0);
    const remainder = sum % 11;
    if ((remainder < 2 ? 0 : 11 - remainder) !== digits[length])
      return false;
  }
  return true;
}
function shannonEntropy(text2) {
  if (text2.length === 0)
    return 0;
  const counts = /* @__PURE__ */ new Map();
  for (const char of text2)
    counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count2 of counts.values()) {
    const p = count2 / text2.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// ../core/dist/src/redact/patterns-generic.js
var marker = (id) => `[REDACTED:${id}]`;
var REDACTION_MARKER = /\[REDACTED:[a-z0-9_]+\]/;
var MARKER_PREFIX = "[REDACTED:";
function countMarkers(text2) {
  let count2 = 0;
  let from = text2.indexOf(MARKER_PREFIX);
  while (from !== -1) {
    const end = text2.indexOf("]", from);
    if (end === -1)
      break;
    if (REDACTION_MARKER.test(text2.slice(from, end + 1)))
      count2++;
    from = text2.indexOf(MARKER_PREFIX, end + 1);
  }
  return count2;
}
var whole = (id) => () => marker(id);
var keepPrefix = (id, groupCount) => (_match, groups) => groups.slice(0, groupCount).join("") + marker(id);
var HEX_ONLY = /^[0-9a-fA-F]+$/;
var HEX_CHUNK = /^(?:[0-9a-f]+|[0-9A-F]+)$/;
var CHUNK_SEPARATORS = /[+/=_-]+/;
var SECRET_KEYWORD = /key|token|secret|password|auth|bearer|signature/i;
var EMBEDDED_IDS = [
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
  /(?<![0-9A-Z])[0-7][0-9A-HJKMNP-TV-Z]{25}(?![0-9A-Z])/g,
  /(?<![0-9a-fA-F])[0-9a-f]{40}(?:[0-9a-f]{24})?(?![0-9a-fA-F])/g
];
var HIGH_ENTROPY_MIN_LENGTH = 32;
var HIGH_ENTROPY_MIN_BITS = 4;
var SWITCH_RATIO_MIN = 0.15;
function characterClasses(text2) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[+/=_-]/].filter((pattern) => pattern.test(text2)).length;
}
var LOWER = 0;
var UPPER = 1;
var DIGIT = 2;
function charClass(code) {
  if (code >= 97 && code <= 122)
    return LOWER;
  if (code >= 65 && code <= 90)
    return UPPER;
  return DIGIT;
}
function classSwitchRatio(text2) {
  let pairs = 0;
  let switches = 0;
  for (const chunk of text2.split(CHUNK_SEPARATORS)) {
    if (chunk.length < 2 || HEX_CHUNK.test(chunk))
      continue;
    let previous = charClass(chunk.charCodeAt(0));
    for (let i = 1; i < chunk.length; i++) {
      const current = charClass(chunk.charCodeAt(i));
      pairs++;
      if (current !== previous && !(previous === UPPER && current === LOWER))
        switches++;
      previous = current;
    }
  }
  return pairs === 0 ? null : switches / pairs;
}
var highEntropy = (run, _groups, offset, text2) => {
  const keywordBefore = () => SECRET_KEYWORD.test(text2.slice(Math.max(0, offset - 20), offset));
  if (HEX_ONLY.test(run))
    return keywordBefore() ? marker("high_entropy") : run;
  let rest = run;
  for (const pattern of EMBEDDED_IDS)
    rest = rest.replace(pattern, "");
  if (rest.length < HIGH_ENTROPY_MIN_LENGTH)
    return run;
  if (characterClasses(rest) < 3)
    return run;
  if (shannonEntropy(rest) < HIGH_ENTROPY_MIN_BITS)
    return run;
  const ratio = classSwitchRatio(rest);
  if (ratio === null)
    return keywordBefore() ? marker("high_entropy") : run;
  return ratio >= SWITCH_RATIO_MIN ? marker("high_entropy") : run;
};
var MYSQL_PASSWORD_FLAG = /(\s)-p(?!\s)\S+/g;
var checkedDigits = (id, valid) => (match) => valid(match) ? marker(id) : match;
var FORMAT_RULES = [
  {
    id: "private_key",
    patterns: [
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g
    ],
    replace: whole("private_key")
  },
  {
    id: "jwt",
    patterns: [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
    replace: whole("jwt")
  },
  { id: "openrouter_key", patterns: [/\bsk-or-v1-[0-9a-f]{64}\b/g], replace: whole("openrouter_key") },
  { id: "anthropic_key", patterns: [/\bsk-ant-[A-Za-z0-9_-]{20,}/g], replace: whole("anthropic_key") },
  { id: "openai_key", patterns: [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g], replace: whole("openai_key") },
  { id: "google_api_key", patterns: [/\bAIza[0-9A-Za-z_-]{35}\b/g], replace: whole("google_api_key") },
  {
    id: "github_token",
    patterns: [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
    replace: whole("github_token")
  },
  { id: "gitlab_token", patterns: [/\bglpat-[A-Za-z0-9_-]{20,}\b/g], replace: whole("gitlab_token") },
  { id: "slack_token", patterns: [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g], replace: whole("slack_token") },
  { id: "aws_access_key_id", patterns: [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g], replace: whole("aws_access_key_id") },
  { id: "npm_token", patterns: [/\bnpm_[A-Za-z0-9]{36}\b/g], replace: whole("npm_token") },
  { id: "stripe_key", patterns: [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g], replace: whole("stripe_key") }
];
var CONTEXT_RULES = [
  {
    id: "auth_header",
    patterns: [
      /\b(cookie|set-cookie)(\s*[:=]\s*)([^\r\n"']+)/gi,
      /\b(authorization|proxy-authorization|x-api-key|api-key|x-auth-token)(\s*[:=]\s*)("[^"]*"|'[^']*'|(?:bearer|basic|token|digest|negotiate)\s+[^\s,;"']+|[^\s,;"']+)/gi
    ],
    replace: keepPrefix("auth_header", 2)
  },
  {
    id: "bearer",
    patterns: [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi],
    replace: (_match, groups) => `${groups[0] ?? ""} ${marker("bearer")}`
  },
  {
    id: "url_userinfo",
    patterns: [/(:\/\/)([^\s/:@[\]]+):([^\s/@]+)@/g],
    replace: (_match, groups) => `${groups[0] ?? ""}${groups[1] ?? ""}:${marker("url_password")}@`
  },
  {
    id: "url_token_user",
    patterns: [/(:\/\/)([A-Za-z0-9_.-]{20,})@/g],
    replace: (_match, groups) => `${groups[0] ?? ""}${marker("url_token")}@`
  },
  {
    id: "url_query_secret",
    patterns: [
      /([?&](?:access_token|token|api_key|apikey|key|secret|password|passwd|sig|signature|code|client_secret|auth)=)[^&#\s"']+/gi
    ],
    replace: keepPrefix("url_query_secret", 1)
  },
  {
    id: "env_assign",
    patterns: [
      /(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]*?(?:API_?KEY|TOKEN(?!S)|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_KEY|ACCESS_KEY|AUTH))([A-Za-z0-9_]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s;&|]+)/gi
    ],
    replace: keepPrefix("env", 2)
  },
  {
    id: "cli_flag_secret",
    patterns: [
      /(--?(?:password|passwd|pass|token|api-key|apikey|secret|client-secret|auth-token|access-token|private-key|key-password)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi
    ],
    replace: keepPrefix("cli_flag_secret", 1)
  },
  {
    id: "mysql_inline_password",
    patterns: [/\b(?:mysql|mysqldump|mariadb)\b[^|;&\n]*/g],
    replace: (segment) => segment.replace(MYSQL_PASSWORD_FLAG, `$1-p${marker("password")}`)
  },
  {
    id: "high_entropy",
    patterns: [/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}/g],
    replace: highEntropy
  },
  {
    id: "cpf_formatted",
    patterns: [/(?<![0-9])[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}(?![0-9])/g],
    replace: whole("cpf_formatted")
  },
  {
    id: "cnpj_formatted",
    patterns: [/(?<![0-9])[0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2}(?![0-9])/g],
    replace: whole("cnpj_formatted")
  },
  {
    id: "celular_br",
    patterns: [/(?<![0-9])\(?[0-9]{2}\)? ?9[0-9]{4}-?[0-9]{4}(?![0-9])/g],
    replace: whole("celular_br")
  },
  {
    id: "cpf_raw",
    patterns: [/(?<![0-9])[0-9]{11}(?![0-9])/g],
    replace: checkedDigits("cpf_raw", cpfCheckDigitsValid)
  },
  {
    id: "cnpj_raw",
    patterns: [/(?<![0-9])[0-9]{14}(?![0-9])/g],
    replace: checkedDigits("cnpj_raw", cnpjCheckDigitsValid)
  },
  {
    id: "email",
    patterns: [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}\b(?!:)/g],
    replace: whole("email")
  }
];
var REDACTION_RULES = [...FORMAT_RULES, ...CONTEXT_RULES];

// ../core/dist/src/redact/redact.js
function applyRule(text2, rule) {
  let count2 = 0;
  let out = text2;
  for (const pattern of rule.patterns) {
    out = out.replace(pattern, (...args) => {
      const match = String(args[0]);
      const hasNamed = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
      const tail = hasNamed ? 3 : 2;
      const groups = args.slice(1, args.length - tail);
      const offset = Number(args[args.length - tail]);
      const whole2 = String(args[args.length - tail + 1]);
      const replaced = rule.replace(match, groups, offset, whole2);
      if (replaced !== match)
        count2 += Math.max(1, countMarkers(replaced) - countMarkers(match));
      return replaced;
    });
  }
  return { value: out, count: count2 };
}
var MAX_PASSES = 8;
function redactPass(text2) {
  let count2 = 0;
  let value = text2;
  for (const rule of REDACTION_RULES) {
    const result = applyRule(value, rule);
    value = result.value;
    count2 += result.count;
  }
  return { value, count: count2 };
}
function redactText(text2) {
  let count2 = 0;
  let value = text2;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = redactPass(value);
    count2 += result.count;
    if (result.value === value)
      break;
    value = result.value;
  }
  return { value, count: count2 };
}
function redact(text2) {
  return redactText(text2).value;
}
var KEY_MARKER = marker("key");
function redactValue(value, options = {}) {
  let count2 = 0;
  const ancestors = /* @__PURE__ */ new WeakSet();
  const keys = /* @__PURE__ */ new Map();
  const redactKey = (key) => {
    let result = keys.get(key);
    if (result === void 0) {
      result = redactText(key);
      keys.set(key, result);
    }
    count2 += result.count;
    return result.value;
  };
  const visit = (node, untrusted, depth) => {
    if (typeof node === "string") {
      const result = redactText(node);
      count2 += result.count;
      return result.value;
    }
    if (typeof node !== "object" || node === null)
      return node;
    if (depth > MAX_VISIT_DEPTH)
      return DEPTH_MARKER;
    if (ancestors.has(node))
      return CYCLE_MARKER;
    ancestors.add(node);
    let out;
    if (Array.isArray(node)) {
      out = node.map((item) => visit(item, untrusted, depth + 1));
    } else {
      const record = {};
      for (const [key, child] of Object.entries(node)) {
        const target = uniqueKey(record, redactKey(key));
        if (untrusted && isSecretKey(key) && child !== null && child !== void 0 && child !== KEY_MARKER) {
          count2++;
          setEntry(record, target, KEY_MARKER);
        } else {
          setEntry(record, target, visit(child, untrusted || UNTRUSTED_SUBTREES.has(key), depth + 1));
        }
      }
      out = record;
    }
    ancestors.delete(node);
    return out;
  };
  return { value: visit(value, options.untrusted ?? false, 0), count: count2 };
}

// src/debug.ts
var SILENT_LOG = { log: () => void 0 };
function createDebugLog(stateDir, now, pid) {
  if (stateDir === null) return SILENT_LOG;
  const path = join4(stateDir, "debug.log");
  return {
    log(stage, details = {}) {
      const fields = [];
      for (const [key, value] of Object.entries(details)) {
        if (value === void 0) continue;
        fields.push(`${key}=${typeof value === "string" ? JSON.stringify(redact(value)) : String(value)}`);
      }
      const line = `${new Date(now()).toISOString()} pid=${pid} ${stage}${fields.length > 0 ? ` ${fields.join(" ")}` : ""}
`;
      if ((fileSize(path) ?? 0) >= DEBUG_LOG.rotateBytes) renameQuietly(path, `${path}.1`);
      appendExclusive(path, () => line);
    }
  };
}

// src/drain.ts
import { readdirSync } from "node:fs";
import { basename as basename2, dirname as dirname2, join as join5 } from "node:path";

// contract-snapshot:telemetry
var SCHEMA_V1 = "playbook.telemetry/v1";

// src/drain.ts
var DRAINING_INFIX = ".draining-";
function containmentOf(deps) {
  let lost = false;
  return {
    holds(opened) {
      if (!lost && deps.contained !== void 0 && !deps.contained(opened)) lost = true;
      return !lost;
    }
  };
}
var SIDE_SUFFIXES = [".sent", ".batch-max"];
function drainingFiles(spoolPath) {
  const prefix = `${basename2(spoolPath)}${DRAINING_INFIX}`;
  try {
    return readdirSync(dirname2(spoolPath)).filter((name) => name.startsWith(prefix) && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(name.slice(prefix.length))).sort().map((name) => join5(dirname2(spoolPath), name));
  } catch {
    return [];
  }
}
function hasPending(spoolPath) {
  return (fileSize(spoolPath) ?? 0) > 0 || drainingFiles(spoolPath).length > 0;
}
function acquireLock(lockPath, deps, containment) {
  const content = JSON.stringify({ pid: deps.pid, host: deps.host, ts: deps.now() });
  const create = () => {
    if (!containment.holds()) return "uncontained";
    const created = createExclusive(lockPath, content);
    if (created !== true) return created === "exists" ? "exists" : "busy";
    return containment.holds() ? "acquired" : "uncontained";
  };
  const first = create();
  if (first !== "exists") return first;
  const observed = entryIdentity(lockPath);
  if (observed === null) return "busy";
  const stale = !observed.regular || deps.now() - observed.mtimeMs > SPOOL.lockStaleMs;
  if (!stale) return "busy";
  if (!containment.holds()) return "uncontained";
  if (!retireStaleLock(lockPath, observed, deps.ulid())) return "busy";
  const second = create();
  return second === "exists" ? "busy" : second;
}
function retireStaleLock(lockPath, observed, suffix) {
  const aside = `${lockPath}.stale-${suffix}`;
  if (!renameQuietly(lockPath, aside)) return false;
  const moved = entryIdentity(aside);
  if (moved !== null && sameFile(moved, observed)) {
    removeQuietly(aside);
    return true;
  }
  restoreWithoutOverwrite(aside, lockPath);
  return false;
}
function readInteger(path) {
  const content = readSmallText(path, 64)?.trim();
  return content !== void 0 && /^\d{1,15}$/.test(content) ? Number(content) : null;
}
function cleanup(draining, containment) {
  if (!containment.holds()) return;
  removeQuietly(draining);
  for (const suffix of SIDE_SUFFIXES) removeQuietly(`${draining}${suffix}`);
}
function replayable(line) {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) && parsed.schema === SCHEMA_V1 && typeof parsed.event_id === "string" && isRecord(parsed.source) && parsed.source.kind === "hook";
  } catch {
    return false;
  }
}
function collectBatch(chunk, maxEvents, fileEnded, settled) {
  const batch = { lines: [], consumed: 0, skipped: 0, partialBytes: 0 };
  let bodyBytes = 2;
  let start = 0;
  while (start < chunk.length && batch.lines.length < maxEvents) {
    const newline = chunk.indexOf(10, start);
    if (newline === -1) {
      if (!fileEnded && start === 0 && chunk.length >= PAYLOAD.maxLineBytes) {
        batch.consumed = chunk.length;
        batch.skipped++;
      } else if (fileEnded && settled) {
        batch.partialBytes = chunk.length - start;
      }
      break;
    }
    const line = chunk.subarray(start, newline).toString("utf8").trim();
    const next = newline + 1;
    if (line === "") {
      start = next;
      batch.consumed = next;
      continue;
    }
    if (!replayable(line)) {
      batch.skipped++;
      start = next;
      batch.consumed = next;
      continue;
    }
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (batch.lines.length > 0 && bodyBytes + lineBytes > PAYLOAD.batchBytes) break;
    batch.lines.push(line);
    bodyBytes += lineBytes;
    start = next;
    batch.consumed = next;
  }
  return batch;
}
function settledAt(mtimeMs, deps) {
  return mtimeMs < deps.now() - SPOOL.drainingSettleMs;
}
function pickDraining(spoolPath, deps, containment) {
  for (const candidate of drainingFiles(spoolPath)) {
    const current = fileIdentity(candidate);
    if (current === null) continue;
    if ((readInteger(`${candidate}.sent`) ?? 0) < current.size) return candidate;
    if (settledAt(current.mtimeMs, deps)) cleanup(candidate, containment);
  }
  if ((fileSize(spoolPath) ?? 0) === 0 || !containment.holds()) return null;
  const renamed = `${spoolPath}${DRAINING_INFIX}${deps.ulid()}`;
  return renameQuietly(spoolPath, renamed) ? renamed : null;
}
function requeue(spoolPath, lines, containment) {
  if (lines.length === 0 || !containment.holds()) return 0;
  const result = appendExclusive(
    spoolPath,
    (_size, opened) => containment.holds(opened) ? lines.map((line) => `${line}
`).join("") : null
  );
  return result === null || result === "refused" ? 0 : lines.length;
}
function confirm(draining, read, offset, batch, deps, containment) {
  const current = fileIdentity(draining);
  const unchanged = current !== null && current.dev === read.dev && current.ino === read.ino && current.size === read.size && settledAt(current.mtimeMs, deps);
  const droppedPartial = batch.partialBytes > 0 && unchanged;
  const to = offset + batch.consumed + (droppedPartial ? batch.partialBytes : 0);
  if (to > offset && containment.holds()) writeAtomic(`${draining}.sent`, String(to), `${deps.pid}-${deps.ulid()}`);
  if (unchanged && to >= read.size) cleanup(draining, containment);
  return { droppedPartial };
}
async function drainOnce(spoolPath, deps) {
  const lockPath = `${spoolPath}.lock`;
  const containment = containmentOf(deps);
  const lock = acquireLock(lockPath, deps, containment);
  if (lock !== "acquired") return { status: lock };
  deps.onLock?.(lockPath);
  try {
    const draining = pickDraining(spoolPath, deps, containment);
    if (draining === null) return containment.holds() ? { status: "empty" } : { status: "uncontained" };
    const offset = readInteger(`${draining}.sent`) ?? 0;
    const maxEvents = Math.max(
      1,
      Math.min(PAYLOAD.batchEvents, readInteger(`${draining}.batch-max`) ?? PAYLOAD.batchEvents)
    );
    const range = readRange(draining, offset, PAYLOAD.batchBytes + PAYLOAD.maxLineBytes);
    if (range === null || offset >= range.size) return { status: "empty" };
    const fileEnded = offset + range.data.length >= range.size;
    const batch = collectBatch(range.data, maxEvents, fileEnded, settledAt(range.identity.mtimeMs, deps));
    const settle = () => confirm(draining, range.identity, offset, batch, deps, containment).droppedPartial ? 1 : 0;
    if (batch.lines.length === 0) return { status: "skipped", skipped: batch.skipped + settle() };
    const outcome = await deps.post(`[${batch.lines.join(",")}]`);
    switch (outcome.kind) {
      case "accepted": {
        const retry = outcome.rejected.filter((rejection) => rejection.retryable).map((rejection) => rejection.index);
        const requeued = requeue(
          spoolPath,
          retry.flatMap((index) => batch.lines[index] === void 0 ? [] : [batch.lines[index]]),
          containment
        );
        const skipped = batch.skipped + settle();
        return { status: "sent", sent: batch.lines.length, skipped, requeued, outcome };
      }
      case "discard": {
        const skipped = batch.skipped + batch.lines.length + settle();
        return { status: "sent", sent: 0, skipped, requeued: 0, outcome };
      }
      case "too_large":
        if (batch.lines.length === 1) {
          return { status: "sent", sent: 0, skipped: batch.skipped + 1 + settle(), requeued: 0, outcome };
        }
        if (containment.holds()) {
          writeAtomic(`${draining}.batch-max`, String(Math.floor(batch.lines.length / 2)), `${deps.pid}-${deps.ulid()}`);
        }
        return { status: "kept", sent: 0, outcome };
      default:
        return { status: "kept", sent: 0, outcome };
    }
  } finally {
    if (containment.holds()) removeQuietly(lockPath);
    deps.onLock?.(null);
  }
}

// contract-snapshot:data-spec
var DATA_SPECS = { "session.start": { "required": ["trigger"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/permission_mode", { "maxLength": 32 }], ["/effort", { "maxLength": 16 }], ["/mcp_servers", { "maxItems": 20 }], ["/mcp_servers/*/name", { "maxLength": 64 }], ["/mcp_servers/*/status", { "maxLength": 32 }], ["/api_key_source", { "maxLength": 32 }], ["/agent_definition", { "maxLength": 64 }], ["/model_display", { "maxLength": 64 }]] }, "session.end": { "required": ["status"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/reason", { "maxLength": 48 }], ["/error_code", { "maxLength": 64 }]] }, "prompt.submit": { "required": ["origin", "chars"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/preview", { "maxLength": 160, "detail": "verbose" }]] }, "tool.pre": { "required": ["tool_name", "tool_category", "category_source"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/tool_name", { "maxLength": 128 }], ["/classifier_rule", { "maxLength": 48 }], ["/tool_use_id", { "maxLength": 128 }], ["/target/path", { "maxLength": 512 }], ["/target/command", { "maxLength": 512, "detail": "standard" }], ["/target/command_head", { "maxLength": 64 }], ["/target/description", { "maxLength": 160, "detail": "standard" }], ["/target/url", { "maxLength": 256 }], ["/target/pattern", { "maxLength": 120, "detail": "standard" }], ["/target/subagent_type", { "maxLength": 128 }], ["/target/mcp/server", { "maxLength": 64 }], ["/target/mcp/tool", { "maxLength": 128 }], ["/input_preview", { "maxLength": 2048, "detail": "verbose" }]] }, "tool.post": { "required": ["tool_name", "tool_category", "category_source"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/tool_name", { "maxLength": 128 }], ["/classifier_rule", { "maxLength": 48 }], ["/tool_use_id", { "maxLength": 128 }], ["/target/path", { "maxLength": 512 }], ["/target/command", { "maxLength": 512, "detail": "standard" }], ["/target/command_head", { "maxLength": 64 }], ["/target/description", { "maxLength": 160, "detail": "standard" }], ["/target/url", { "maxLength": 256 }], ["/target/pattern", { "maxLength": 120, "detail": "standard" }], ["/target/subagent_type", { "maxLength": 128 }], ["/target/mcp/server", { "maxLength": 64 }], ["/target/mcp/tool", { "maxLength": 128 }], ["/input_preview", { "maxLength": 2048, "detail": "verbose" }], ["/output_preview", { "maxLength": 1024, "detail": "verbose" }]] }, "tool.fail": { "required": ["tool_name", "tool_category", "category_source", "error_kind"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/tool_name", { "maxLength": 128 }], ["/classifier_rule", { "maxLength": 48 }], ["/tool_use_id", { "maxLength": 128 }], ["/target/path", { "maxLength": 512 }], ["/target/command", { "maxLength": 512, "detail": "standard" }], ["/target/command_head", { "maxLength": 64 }], ["/target/description", { "maxLength": 160, "detail": "standard" }], ["/target/url", { "maxLength": 256 }], ["/target/pattern", { "maxLength": 120, "detail": "standard" }], ["/target/subagent_type", { "maxLength": 128 }], ["/target/mcp/server", { "maxLength": 64 }], ["/target/mcp/tool", { "maxLength": 128 }], ["/input_preview", { "maxLength": 2048, "detail": "verbose" }], ["/error", { "maxLength": 512, "detail": "standard" }]] }, "subagent.start": { "required": ["agent_type"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/agent_id", { "maxLength": 128 }], ["/parent_tool_use_id", { "maxLength": 128 }], ["/agent_type", { "maxLength": 128 }], ["/role", { "maxLength": 64 }], ["/description", { "maxLength": 200, "detail": "standard" }], ["/model_requested", { "maxLength": 64 }]] }, "subagent.stop": { "required": ["status"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/agent_id", { "maxLength": 128 }], ["/parent_tool_use_id", { "maxLength": 128 }], ["/agent_type", { "maxLength": 128 }], ["/role", { "maxLength": 64 }], ["/model_resolved", { "maxLength": 128 }]] }, "handoff.pointer": { "required": ["source", "valid"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/agent", { "maxLength": 64 }], ["/model", { "maxLength": 128 }], ["/artifact_path", { "maxLength": 256 }], ["/files_changed", { "maxItems": 100 }], ["/files_changed/*", { "maxLength": 512 }], ["/next_agent", { "maxLength": 64 }], ["/context_for_next", { "maxLength": 1024, "detail": "standard" }], ["/blockers", { "maxItems": 20, "detail": "standard" }], ["/blockers/*", { "maxLength": 512 }], ["/skill_candidates", { "maxItems": 20 }], ["/skill_candidates/*", { "maxLength": 200 }], ["/needs_human/question", { "maxLength": 1024 }], ["/needs_human/options", { "maxItems": 10 }], ["/needs_human/options/*", { "maxLength": 200 }], ["/validation_errors", { "maxItems": 10 }], ["/validation_errors/*", { "maxLength": 200 }], ["/raw", { "maxLength": 4096, "detail": "standard" }]] }, "permission.request": { "required": ["request_id", "mechanism", "tool_name", "tool_category"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/request_id", { "maxLength": 128 }], ["/tool_name", { "maxLength": 128 }], ["/tool_use_id", { "maxLength": 128 }], ["/target/path", { "maxLength": 512 }], ["/target/command", { "maxLength": 512, "detail": "standard" }], ["/target/command_head", { "maxLength": 64 }], ["/target/description", { "maxLength": 160, "detail": "standard" }], ["/target/url", { "maxLength": 256 }], ["/target/pattern", { "maxLength": 120, "detail": "standard" }], ["/target/subagent_type", { "maxLength": 128 }], ["/target/mcp/server", { "maxLength": 64 }], ["/target/mcp/tool", { "maxLength": 128 }]] }, "permission.resolved": { "required": ["decision", "decided_by"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/request_id", { "maxLength": 128 }], ["/tool_name", { "maxLength": 128 }], ["/tool_use_id", { "maxLength": 128 }], ["/decision_id", { "maxLength": 64 }], ["/message", { "maxLength": 256, "detail": "standard" }]] }, "notification": { "required": ["kind"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/kind", { "maxLength": 48 }], ["/message", { "maxLength": 512, "detail": "standard" }], ["/model_from", { "maxLength": 128 }], ["/model_to", { "maxLength": 128 }], ["/status", { "maxLength": 32 }], ["/termination_reason", { "maxLength": 48 }], ["/mcp/failed", { "maxItems": 50 }], ["/mcp/failed/*", { "maxLength": 64 }], ["/mcp/needs_auth", { "maxItems": 50 }], ["/mcp/needs_auth/*", { "maxLength": 64 }], ["/pr/repository", { "maxLength": 256 }]] }, "decision.requested": { "required": ["decision_id", "source", "question", "blocking", "priority", "requester"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/rule", { "maxLength": 48 }], ["/question", { "maxLength": 1024 }], ["/options", { "maxItems": 10 }], ["/options/*/id", { "maxLength": 32 }], ["/options/*/label", { "maxLength": 200 }], ["/recommendation/option_id", { "maxLength": 32 }], ["/recommendation/rationale", { "maxLength": 1024 }], ["/requester/run_id", { "maxLength": 64 }], ["/requester/role", { "maxLength": 64 }], ["/requester/session_id", { "maxLength": 128 }], ["/requester/agent_name", { "maxLength": 64 }], ["/context_ref", { "maxLength": 256 }]] }, "decision.answered": { "required": ["decision_id", "answer", "answered_by", "latency_ms", "delivered"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/decision_id", { "maxLength": 64 }], ["/answer/option_id", { "maxLength": 32 }], ["/answer/free_text", { "maxLength": 2048 }]] }, "bus.message": { "required": ["message_id", "phase", "from", "to", "kind", "body_chars", "cross_runtime"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/from/run_id", { "maxLength": 64 }], ["/from/role", { "maxLength": 64 }], ["/from/session_id", { "maxLength": 128 }], ["/from/agent_name", { "maxLength": 64 }], ["/to/run_id", { "maxLength": 64 }], ["/to/role", { "maxLength": 64 }], ["/to/session_id", { "maxLength": 128 }], ["/to/agent_name", { "maxLength": 64 }], ["/subject", { "maxLength": 200, "detail": "standard" }], ["/body_preview", { "maxLength": 256, "detail": "verbose" }], ["/in_reply_to", { "maxLength": 64 }]] }, "bus.handoff": { "required": ["message_id", "from", "to", "task_id", "cross_runtime"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/from/run_id", { "maxLength": 64 }], ["/from/role", { "maxLength": 64 }], ["/from/session_id", { "maxLength": 128 }], ["/from/agent_name", { "maxLength": 64 }], ["/to/run_id", { "maxLength": 64 }], ["/to/role", { "maxLength": 64 }], ["/to/session_id", { "maxLength": 128 }], ["/to/agent_name", { "maxLength": 64 }], ["/pointer/agent", { "maxLength": 64 }], ["/pointer/model", { "maxLength": 128 }], ["/pointer/artifact_path", { "maxLength": 256 }], ["/pointer/files_changed", { "maxItems": 100 }], ["/pointer/files_changed/*", { "maxLength": 512 }], ["/pointer/next_agent", { "maxLength": 64 }], ["/pointer/context_for_next", { "maxLength": 1024, "detail": "standard" }], ["/pointer/blockers", { "maxItems": 20, "detail": "standard" }], ["/pointer/blockers/*", { "maxLength": 512 }], ["/pointer/skill_candidates", { "maxItems": 20 }], ["/pointer/skill_candidates/*", { "maxLength": 200 }], ["/pointer/needs_human/question", { "maxLength": 1024 }], ["/pointer/needs_human/options", { "maxItems": 10 }], ["/pointer/needs_human/options/*", { "maxLength": 200 }]] }, "bus.claim": { "required": ["claim_id", "task_id", "claimed_by", "scope", "result"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/claim_id", { "maxLength": 64 }], ["/claimed_by/run_id", { "maxLength": 64 }], ["/claimed_by/role", { "maxLength": 64 }], ["/claimed_by/session_id", { "maxLength": 128 }], ["/claimed_by/agent_name", { "maxLength": 64 }], ["/files", { "maxItems": 100 }], ["/files/*", { "maxLength": 512 }], ["/conflict_with/run_id", { "maxLength": 64 }], ["/conflict_with/role", { "maxLength": 64 }], ["/conflict_with/session_id", { "maxLength": 128 }], ["/conflict_with/agent_name", { "maxLength": 64 }]] }, "progress.report": { "required": ["kind"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/step", { "maxLength": 16 }], ["/phase", { "maxLength": 32 }], ["/message", { "maxLength": 280, "detail": "standard" }]] }, "usage.report": { "required": ["scope", "cumulative", "billing", "tokens", "cost_kind"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/per_model", { "maxItems": 10 }], ["/per_model/*/model", { "maxLength": 128 }], ["/per_model/*/canonical", { "maxLength": 128 }], ["/message_id", { "maxLength": 128 }], ["/upstream_provider", { "maxLength": 64 }]] }, "limit.hit": { "required": ["limit_kind", "detected_from"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/window", { "maxLength": 32 }], ["/error_code", { "maxLength": 64 }], ["/message", { "maxLength": 512, "detail": "standard" }]] }, "limit.status": { "required": ["status", "source"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/window", { "maxLength": 32 }], ["/overage/status", { "maxLength": 32 }], ["/overage/disabled_reason", { "maxLength": 64 }]] }, "flow.step": { "required": ["origin", "flow", "step_id", "state"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/flow", { "maxLength": 48 }], ["/step_id", { "maxLength": 64 }], ["/role", { "maxLength": 64 }], ["/label", { "maxLength": 64 }], ["/phase", { "maxLength": 32 }], ["/parallel_group", { "maxLength": 32 }], ["/raw_event", { "maxLength": 48 }], ["/raw_status", { "maxLength": 48 }], ["/ref", { "maxLength": 256 }]] }, "gate.verdict": { "required": ["gate", "artifact_path", "verdict", "first_line_rule", "file_sha256"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/gate", { "maxLength": 48 }], ["/artifact_path", { "maxLength": 256 }]] }, "task.indexed": { "required": ["change", "key", "format", "content_hash", "status", "has"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/key", { "maxLength": 256 }], ["/title", { "maxLength": 200 }], ["/sensitive_source", { "maxItems": 3 }], ["/data_class", { "maxLength": 16 }], ["/flow", { "maxLength": 64 }], ["/phase", { "maxLength": 48 }], ["/gates/reviewer", { "maxLength": 48 }], ["/gates/security_sre", { "maxLength": 48 }], ["/last_row/agent", { "maxLength": 64 }], ["/last_row/event", { "maxLength": 48 }], ["/last_row/status", { "maxLength": 48 }]] }, "run.state": { "required": ["state", "role", "billing"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/reason", { "maxLength": 48 }], ["/role", { "maxLength": 64 }], ["/step/flow", { "maxLength": 48 }], ["/fallback/from/provider", { "maxLength": 64 }], ["/fallback/from/model", { "maxLength": 128 }], ["/fallback/to/provider", { "maxLength": 64 }], ["/fallback/to/model", { "maxLength": 128 }]] }, "compact": { "required": ["phase", "trigger"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }]] }, "error": { "required": ["scope", "code", "fatal"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/code", { "maxLength": 64 }], ["/message", { "maxLength": 1024, "detail": "standard" }], ["/hook_event", { "maxLength": 48 }]] }, "alert": { "required": ["kind"], "fields": [["/truncated", { "maxItems": 20 }], ["/truncated/*", { "maxLength": 128 }], ["/kind", { "maxLength": 48 }], ["/message", { "maxLength": 512, "detail": "standard" }], ["/scope", { "maxLength": 48 }], ["/dedupe_key", { "maxLength": 128 }]] } };
var cache = /* @__PURE__ */ new Map();
function getDataSpec(type) {
  let spec = cache.get(type);
  if (spec === void 0) {
    const raw = DATA_SPECS[type];
    if (raw === void 0) throw new Error("tipo de evento fora do contrato: " + type);
    spec = { type, required: raw.required, fields: new Map(raw.fields) };
    cache.set(type, spec);
  }
  return spec;
}

// ../core/dist/src/redact/paths.js
var DEFAULT_TMP_DIRS = ["/tmp", "/var/tmp"];
var GENERIC_HOME = /^(?:\/home\/[^/]+|\/Users\/[^/]+|[a-z]:\/users\/[^/]+)(?=\/|$)/i;
function tmpDirsOf(context) {
  return [...DEFAULT_TMP_DIRS, ...context.tmpDirs ?? []].map(normalizePath);
}
function homeOf(path, context) {
  if (context.home !== void 0 && context.home !== "") {
    const home = normalizePath(context.home);
    if (isSameOrInside(path, home))
      return home;
  }
  return GENERIC_HOME.exec(path)?.[0] ?? null;
}
function normalizeTargetPath(path, context) {
  const posix2 = toPosixPath(path.trim());
  if (posix2 === "")
    return posix2;
  let absolute;
  if (isAbsolutePath(posix2))
    absolute = normalizePath(posix2);
  else if (context.cwd !== void 0 && isAbsolutePath(context.cwd))
    absolute = joinPath(context.cwd, posix2);
  else {
    const relative = normalizePath(posix2);
    return relative === ".." || relative.startsWith("../") ? `[ext]/${basenamePath(relative)}` : relative;
  }
  const inside = relativeInside(absolute, normalizePath(context.root));
  if (inside !== null)
    return inside;
  const name = basenamePath(absolute);
  if (tmpDirsOf(context).some((dir) => isSameOrInside(absolute, dir)))
    return `[tmp]/${name}`;
  const home = homeOf(absolute, context);
  if (home !== null)
    return absolute === home ? "~" : `~/…/${name}`;
  return `[ext]/${name}`;
}
function escapeRegExp(text2) {
  return text2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var PATH_TERMINATOR = `[\\s'"\`:;,)|&<>\\]}]`;
var PATH_BOUNDARY = `(?=[\\\\/]|${PATH_TERMINATOR}|$)`;
var PATH_START = `(?<![\\w.~/\\\\-])`;
function pathVariants(path) {
  const posix2 = normalizePath(path);
  const variants = /* @__PURE__ */ new Set([posix2, posix2.replaceAll("/", "\\")]);
  if (/^[a-z]:\//.test(posix2)) {
    const upper = posix2.charAt(0).toUpperCase() + posix2.slice(1);
    variants.add(upper);
    variants.add(upper.replaceAll("/", "\\"));
  }
  return [...variants].sort((a, b) => b.length - a.length);
}
function replacePathPrefix(text2, path, replacement) {
  let out = text2;
  for (const variant of pathVariants(path)) {
    if (variant === "/" || variant === "")
      continue;
    out = out.replace(new RegExp(`${PATH_START}${escapeRegExp(variant)}${PATH_BOUNDARY}`, "g"), replacement);
  }
  return out;
}
var HOME_IN_TEXT = new RegExp(`${PATH_START}(?:/home/[^/\\s'"\`]+|/Users/[^/\\s'"\`]+|[A-Za-z]:\\\\Users\\\\[^\\\\\\s'"\`]+)${PATH_BOUNDARY}`, "g");
var TILDE_PATH = /(?<![\w.-])~([\\/][^\s'"`;|&<>()]+)/g;
function normalizeFreeText(text2, context) {
  let out = replacePathPrefix(text2, context.root, ".");
  if (context.home !== void 0 && context.home !== "")
    out = replacePathPrefix(out, context.home, "~");
  out = out.replace(HOME_IN_TEXT, "~");
  return out.replace(TILDE_PATH, (match, rest) => {
    const segments = rest.split(/[\\/]+/).filter((segment) => segment !== "");
    if (segments.length < 2)
      return match;
    return `~/…/${segments[segments.length - 1]}`;
  });
}

// ../core/dist/src/redact/truncate.js
function truncateText(text2, max) {
  if (text2.length <= max)
    return text2;
  let keep = max;
  for (; ; ) {
    let cut = Math.max(0, keep);
    const last = text2.charCodeAt(cut - 1);
    if (cut > 0 && last >= 55296 && last <= 56319)
      cut--;
    const suffix = `…[+${text2.length - cut}]`;
    if (cut + suffix.length <= max)
      return text2.slice(0, cut) + suffix;
    if (cut === 0) {
      let hard = max;
      const code = text2.charCodeAt(hard - 1);
      if (hard > 0 && code >= 55296 && code <= 56319)
        hard--;
      return text2.slice(0, hard);
    }
    keep = cut - (cut + suffix.length - max);
  }
}
function pointerSegment(key) {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
function mergeTruncated(existing, added) {
  const out = [];
  const push = (entry2) => {
    const bounded = truncateText(entry2, EVENT_LIMITS.truncatedEntryLength);
    if (!out.includes(bounded) && out.length < EVENT_LIMITS.truncatedEntries)
      out.push(bounded);
  };
  if (Array.isArray(existing)) {
    for (const entry2 of existing)
      if (typeof entry2 === "string")
        push(entry2);
  }
  for (const entry2 of added)
    push(entry2);
  return out;
}
function applyDataLimits(type, data, spec) {
  const fields = (spec ?? getDataSpec(type)).fields;
  const truncated = [];
  const visit = (value, pointer, specPointer, depth) => {
    if (depth > EVENT_LIMITS.dataDepth) {
      truncated.push(pointer);
      return DEPTH_MARKER;
    }
    if (typeof value === "string") {
      const max = fields.get(specPointer)?.maxLength ?? EVENT_LIMITS.stringLength;
      const cut = truncateText(value, max);
      if (cut !== value)
        truncated.push(pointer);
      return cut;
    }
    if (Array.isArray(value)) {
      const maxItems = fields.get(specPointer)?.maxItems ?? EVENT_LIMITS.arrayItems;
      if (value.length > maxItems)
        truncated.push(pointer);
      return value.slice(0, maxItems).map((item, index) => visit(item, `${pointer}/${index}`, `${specPointer}/*`, depth + 1));
    }
    if (isRecord2(value)) {
      const out = {};
      let kept = 0;
      for (const [key, child] of Object.entries(value)) {
        const childPointer = `${pointer}/${pointerSegment(key)}`;
        if (depth === 0 && key === "truncated")
          continue;
        if (key.length > EVENT_LIMITS.keyLength) {
          truncated.push(`${pointer}/${pointerSegment(redact(key).slice(0, 16))}…`);
          continue;
        }
        if (kept >= EVENT_LIMITS.keysPerObject) {
          truncated.push(pointer === "" ? "/" : pointer);
          break;
        }
        setEntry(out, key, visit(child, childPointer, `${specPointer}/${key}`, depth + 1));
        kept++;
      }
      return out;
    }
    return value;
  };
  const limited = visit(data, "", "", 0);
  if ("truncated" in data)
    limited.truncated = data.truncated;
  return { data: limited, truncated };
}
var PREVIEW_FIELDS = ["input_preview", "output_preview", "preview", "body_preview"];
var FREE_STRING_DEGRADED = 256;
var ARRAY_DEGRADED = 10;
function fits(event) {
  return serializedByteLength(event) <= EVENT_LIMITS.eventBytes && serializedByteLength(event.data) <= EVENT_LIMITS.dataBytes;
}
function shrink(value, pointer, rule, truncated) {
  if (typeof value === "string" && rule === "strings") {
    const cut = truncateText(value, FREE_STRING_DEGRADED);
    if (cut !== value)
      truncated.push(pointer);
    return cut;
  }
  if (Array.isArray(value)) {
    const items = rule === "arrays" && value.length > ARRAY_DEGRADED ? value.slice(0, ARRAY_DEGRADED) : value;
    if (items !== value)
      truncated.push(pointer);
    return items.map((item, index) => shrink(item, `${pointer}/${index}`, rule, truncated));
  }
  if (isRecord2(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const shrunk = key === "truncated" && pointer === "" ? child : shrink(child, `${pointer}/${pointerSegment(key)}`, rule, truncated);
      setEntry(out, key, shrunk);
    }
    return out;
  }
  return value;
}
function fitEventSize(event) {
  if (fits(event))
    return event;
  const truncated = [];
  const withData = (data2) => ({
    ...event,
    data: { ...data2, truncated: mergeTruncated(event.data.truncated, truncated) }
  });
  let data = { ...event.data };
  for (const field of PREVIEW_FIELDS) {
    if (field in data) {
      delete data[field];
      truncated.push(`/${field}`);
    }
  }
  if (fits(withData(data)))
    return withData(data);
  if (isRecord2(data.target) && "command" in data.target) {
    const { command: _command, ...target } = data.target;
    data = { ...data, target };
    truncated.push("/target/command");
    if (fits(withData(data)))
      return withData(data);
  }
  data = shrink(data, "", "strings", truncated);
  if (fits(withData(data)))
    return withData(data);
  data = shrink(data, "", "arrays", truncated);
  if (fits(withData(data)))
    return withData(data);
  const minimal = {};
  for (const key of getDataSpec(event.type).required)
    if (key in data)
      minimal[key] = data[key];
  return { ...event, data: { ...minimal, truncated: ["*"] } };
}

// ../core/dist/src/redact/structure.js
var PRE_REDACTION_LIMITS = {
  depth: EVENT_LIMITS.dataDepth,
  keysPerObject: 2 * EVENT_LIMITS.keysPerObject,
  keyLength: 1024,
  stringLength: 64 * 1024
};
function pointerOf(path) {
  return path.map((part) => `/${typeof part === "number" ? part : pointerSegment(redact(part))}`).join("");
}
function boundStructure(data, options = {}) {
  const truncated = [];
  const ancestors = /* @__PURE__ */ new WeakSet();
  const path = [];
  const note = (suffix = "") => {
    const pointer = pointerOf(path) + suffix;
    truncated.push(pointer === "" ? "/" : pointer);
  };
  const visit = (value, specPointer, depth) => {
    if (typeof value === "string") {
      if (value.length <= PRE_REDACTION_LIMITS.stringLength)
        return value;
      note();
      return truncateText(value, PRE_REDACTION_LIMITS.stringLength);
    }
    if (typeof value === "number")
      return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean" || value === null)
      return value;
    if (typeof value === "bigint")
      return value.toString();
    if (typeof value !== "object")
      return void 0;
    if (value instanceof Date)
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (depth > PRE_REDACTION_LIMITS.depth) {
      note();
      return DEPTH_MARKER;
    }
    if (ancestors.has(value))
      return CYCLE_MARKER;
    ancestors.add(value);
    const out = Array.isArray(value) ? visitArray(value, specPointer, depth) : visitRecord(value, specPointer, depth);
    ancestors.delete(value);
    return out;
  };
  const visitArray = (value, specPointer, depth) => {
    const maxItems = options.fields?.get(specPointer)?.maxItems ?? EVENT_LIMITS.arrayItems;
    if (value.length > maxItems)
      note();
    const out = [];
    for (let index = 0; index < Math.min(value.length, maxItems); index++) {
      path.push(index);
      const item = visit(value[index], `${specPointer}/*`, depth + 1);
      path.pop();
      out.push(item === void 0 ? null : item);
    }
    return out;
  };
  const visitRecord = (value, specPointer, depth) => {
    const out = {};
    let kept = 0;
    for (const [key, child] of Object.entries(value)) {
      if (options.drop?.(key, child) === true)
        continue;
      if (key.length > PRE_REDACTION_LIMITS.keyLength) {
        const head = redact(key.slice(0, PRE_REDACTION_LIMITS.keyLength)).slice(0, 16);
        note(`/${pointerSegment(head)}…`);
        continue;
      }
      if (kept >= PRE_REDACTION_LIMITS.keysPerObject) {
        note();
        break;
      }
      path.push(key);
      const bounded = visit(child, `${specPointer}/${key}`, depth + 1);
      path.pop();
      if (bounded === void 0)
        continue;
      setEntry(out, key, bounded);
      kept++;
    }
    return out;
  };
  ancestors.add(data);
  return { data: visitRecord(data, "", 0), truncated };
}

// ../core/dist/src/redact/sanitize.js
var PATH_LIST_FIELDS = /* @__PURE__ */ new Set(["files_changed", "files"]);
function detailRank(level) {
  return DETAIL_LEVELS.indexOf(level);
}
function isNeverExported(key, value) {
  return NEVER_EXPORTED_KEYS.has(key) && typeof value !== "number" && typeof value !== "boolean";
}
function dropNeverExported(value) {
  return copyJson(value, (key, child) => !isNeverExported(key, child));
}
function applyDetailLevel(type, data, level) {
  const removed = [];
  const out = copyJson(data);
  for (const [pointer, spec] of getDataSpec(type).fields) {
    if (spec.detail === void 0 || detailRank(spec.detail) <= detailRank(level) || pointer.includes("*"))
      continue;
    const segments = pointer.split("/").slice(1);
    let parent = out;
    for (const segment of segments.slice(0, -1))
      parent = isRecord2(parent) ? parent[segment] : void 0;
    const last = segments[segments.length - 1];
    if (isRecord2(parent) && last !== void 0 && Object.hasOwn(parent, last)) {
      delete parent[last];
      removed.push(pointer);
    }
  }
  return { data: out, removed };
}
function stripUrlQuery(url) {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
function normalizePaths(value, context, key, parentKey) {
  if (typeof value === "string") {
    if (key === "path" && parentKey === "target" || key !== null && PATH_LIST_FIELDS.has(key)) {
      return normalizeTargetPath(value, context);
    }
    if (key === "url" && parentKey === "target")
      return normalizeFreeText(stripUrlQuery(value), context);
    return normalizeFreeText(value, context);
  }
  if (Array.isArray(value))
    return value.map((item) => normalizePaths(item, context, key, parentKey));
  if (!isRecord2(value))
    return value;
  const out = {};
  for (const [childKey, child] of Object.entries(value)) {
    setEntry(out, childKey, normalizePaths(child, context, childKey, key));
  }
  return out;
}
function sanitizeEventData(type, data, options) {
  const level = options.detail ?? "standard";
  const spec = getDataSpec(type);
  const bounded = boundStructure(data, { fields: spec.fields, drop: isNeverExported });
  const detailed = applyDetailLevel(type, bounded.data, level);
  const normalized = normalizePaths(detailed.data, options.paths, null, null);
  const redacted = redactValue(normalized);
  const limited = applyDataLimits(type, redacted.value, spec);
  const previous = bounded.data.redactions;
  const earlier = typeof previous === "number" && Number.isSafeInteger(previous) && previous >= 0 ? previous : 0;
  const truncated = mergeTruncated(limited.data.truncated, [...bounded.truncated, ...limited.truncated]);
  const out = { ...limited.data, redactions: earlier + redacted.count, detail: level };
  if (truncated.length > 0)
    out.truncated = truncated;
  else
    delete out.truncated;
  return { data: out, redactions: redacted.count, removedByDetail: detailed.removed };
}
function sanitizeEvent(event, options) {
  const { data } = sanitizeEventData(event.type, event.data, options);
  return fitEventSize({ ...event, data });
}

// contract-snapshot:bus
var BUS_TOOL_INTENTS = Object.freeze({ "send_message": "message", "read_inbox": "message", "handoff": "delegate", "claim_task": "claim", "report_progress": "report", "request_human_decision": "ask_human", "permission_prompt": "ask_human" });

// ../core/dist/src/tools/shell-parse.js
var ShellParseError = class extends Error {
  name = "ShellParseError";
};
function splitShell(command) {
  const segments = [];
  let words = [];
  let writeTargets = [];
  let word = "";
  let inWord = false;
  let pending = null;
  const heredocs = [];
  let heredocStripTabs = false;
  const endWord = () => {
    if (!inWord)
      return;
    if (pending !== null) {
      if (pending.kind === "write")
        writeTargets.push(word);
      else if (pending.kind === "heredoc")
        heredocs.push({ delimiter: word, stripTabs: heredocStripTabs });
      pending = null;
    } else
      words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    pending = null;
    if (words.length > 0 || writeTargets.length > 0)
      segments.push({ words, writeTargets });
    words = [];
    writeTargets = [];
  };
  let i = 0;
  const n = command.length;
  while (i < n) {
    const char = command.charAt(i);
    if (char === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0)
        throw new ShellParseError("aspas simples sem fechamento");
      word += command.slice(i + 1, close);
      inWord = true;
      i = close + 1;
      continue;
    }
    if (char === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const inner = command.charAt(i);
        if (inner === '"') {
          closed = true;
          i++;
          break;
        }
        if (inner === "\\" && i + 1 < n && '"\\$`\n'.includes(command.charAt(i + 1))) {
          if (command.charAt(i + 1) !== "\n")
            word += command.charAt(i + 1);
          i += 2;
          continue;
        }
        word += inner;
        i++;
      }
      if (!closed)
        throw new ShellParseError("aspas duplas sem fechamento");
      inWord = true;
      continue;
    }
    if (char === "\\") {
      if (i + 1 < n && command.charAt(i + 1) !== "\n") {
        word += command.charAt(i + 1);
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (char === "$" && command.charAt(i + 1) === "(") {
      const end = matchingParen(command, i + 1);
      word += command.slice(i, end + 1);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (char === "`") {
      const close = command.indexOf("`", i + 1);
      if (close < 0)
        throw new ShellParseError("crase sem fechamento");
      word += command.slice(i, close + 1);
      inWord = true;
      i = close + 1;
      continue;
    }
    if (char === "#" && !inWord) {
      while (i < n && command.charAt(i) !== "\n")
        i++;
      continue;
    }
    if (char === " " || char === "	" || char === "\r") {
      endWord();
      i++;
      continue;
    }
    if (char === "\n") {
      endSegment();
      i++;
      i = skipHeredocBodies(command, i, heredocs);
      heredocs.length = 0;
      continue;
    }
    if (char === ";" || char === "(" || char === ")") {
      endSegment();
      i++;
      continue;
    }
    if (char === "|") {
      endSegment();
      i += command.charAt(i + 1) === "|" || command.charAt(i + 1) === "&" ? 2 : 1;
      continue;
    }
    if (char === "&") {
      if (command.charAt(i + 1) === "&") {
        endSegment();
        i += 2;
        continue;
      }
      if (command.charAt(i + 1) === ">") {
        endWord();
        i += command.charAt(i + 2) === ">" ? 3 : 2;
        pending = { kind: "write" };
        continue;
      }
      endSegment();
      i++;
      continue;
    }
    if (char === ">" || char === "<") {
      if (inWord && /^[0-9]+$/.test(word)) {
        word = "";
        inWord = false;
      } else
        endWord();
      if (char === ">") {
        let j = i + 1;
        if (command.charAt(j) === ">" || command.charAt(j) === "|")
          j++;
        if (command.charAt(j) === "&") {
          pending = { kind: "ignore" };
          j++;
        } else
          pending = { kind: "write" };
        i = j;
        continue;
      }
      if (command.startsWith("<<<", i)) {
        pending = { kind: "ignore" };
        i += 3;
        continue;
      }
      if (command.startsWith("<<", i)) {
        heredocStripTabs = command.charAt(i + 2) === "-";
        pending = { kind: "heredoc" };
        i += heredocStripTabs ? 3 : 2;
        continue;
      }
      pending = { kind: "ignore" };
      i += command.charAt(i + 1) === ">" || command.charAt(i + 1) === "&" ? 2 : 1;
      continue;
    }
    word += char;
    inWord = true;
    i++;
  }
  endSegment();
  return segments;
}
function matchingParen(command, open) {
  let depth = 0;
  for (let i = open; i < command.length; i++) {
    const char = command.charAt(i);
    if (char === "(")
      depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0)
        return i;
    }
  }
  throw new ShellParseError("$( sem fechamento");
}
function skipHeredocBodies(command, start, heredocs) {
  let i = start;
  for (const heredoc of heredocs) {
    for (; ; ) {
      if (i >= command.length)
        return i;
      const end = command.indexOf("\n", i);
      const line = command.slice(i, end < 0 ? command.length : end);
      i = end < 0 ? command.length : end + 1;
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
      if (candidate === heredoc.delimiter)
        break;
    }
  }
  return i;
}

// ../core/dist/src/tools/shell.js
var PRECEDENCE = [
  "shell",
  "read",
  "search",
  "write",
  "edit",
  "fetch",
  "git",
  "db",
  "test"
];
var rank = (category) => PRECEDENCE.indexOf(category);
var MAX_UNWRAP_DEPTH = 3;
var MAX_CLEAN_STEPS = 16;
var HEAD_MAX = 64;
var NEUTRAL = /* @__PURE__ */ new Set(["cd", "pushd", "popd", "set", "source", ".", "true", ":", "export"]);
var SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash"]);
var POWERSHELLS = /* @__PURE__ */ new Set(["pwsh", "powershell"]);
var TEST_PROGS = /* @__PURE__ */ new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "jasmine",
  "karma",
  "pytest",
  "py.test",
  "tox",
  "nox",
  "rspec",
  "phpunit",
  "pest",
  "ctest",
  "bats",
  "behave",
  "cucumber",
  "cucumber-js"
]);
var TEST_SUBCOMMAND = new Map(Object.entries({
  go: /* @__PURE__ */ new Set(["test"]),
  cargo: /* @__PURE__ */ new Set(["test", "nextest"]),
  dotnet: /* @__PURE__ */ new Set(["test"]),
  swift: /* @__PURE__ */ new Set(["test"]),
  deno: /* @__PURE__ */ new Set(["test"]),
  bun: /* @__PURE__ */ new Set(["test"]),
  mix: /* @__PURE__ */ new Set(["test"]),
  lein: /* @__PURE__ */ new Set(["test"]),
  sbt: /* @__PURE__ */ new Set(["test"]),
  playwright: /* @__PURE__ */ new Set(["test"]),
  cypress: /* @__PURE__ */ new Set(["run"])
}));
var TEST_FILE = /^(test|tests)[-_.]|[-_.](test|spec)s?\.[a-z0-9]+$|^run[-_]tests?\b/i;
var TEST_SCRIPT = /^(?:test|t|tests|test:.*|e2e|e2e:.*|spec)$/;
var DB_SCRIPT = /^(?:db|migrate|migration|seed)[-:\w]*$/;
var DB_PROGS = /* @__PURE__ */ new Set([
  "psql",
  "pg_dump",
  "pg_dumpall",
  "pg_restore",
  "createdb",
  "dropdb",
  "mysql",
  "mysqldump",
  "mariadb",
  "mariadb-dump",
  "sqlite3",
  "sqlite",
  "duckdb",
  "mongosh",
  "mongo",
  "mongodump",
  "mongorestore",
  "redis-cli",
  "sqlcmd",
  "clickhouse-client",
  "cqlsh",
  "flyway",
  "liquibase",
  "dbmate",
  "alembic",
  "sqitch"
]);
var GIT_PROGS = /* @__PURE__ */ new Set(["git", "gh", "glab", "hub", "git-lfs", "tig"]);
var FETCH_PROGS = /* @__PURE__ */ new Set(["curl", "wget", "http", "https", "xh", "aria2c"]);
var EDIT_PROGS = /* @__PURE__ */ new Set(["patch", "ed", "ex"]);
var WRITE_PROGS = /* @__PURE__ */ new Set(["cp", "mv", "rm", "mkdir", "rmdir", "touch", "ln", "chmod", "chown", "install", "rsync"]);
var SEARCH_PROGS = /* @__PURE__ */ new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "find",
  "fd",
  "fdfind",
  "ls",
  "tree",
  "locate"
]);
var READ_PROGS = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "batcat",
  "wc",
  "stat",
  "file",
  "jq",
  "yq",
  "xxd",
  "hexdump",
  "od",
  "strings",
  "diff",
  "cmp",
  "md5sum",
  "sha1sum",
  "sha256sum"
]);
var PACKAGE_MANAGERS = /* @__PURE__ */ new Set(["npm", "pnpm", "yarn", "bun"]);
var PM_BUILTINS = /* @__PURE__ */ new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "up",
  "upgrade",
  "ci",
  "publish",
  "pack",
  "init",
  "create",
  "link",
  "ln",
  "unlink",
  "audit",
  "outdated",
  "why",
  "list",
  "ls",
  "config",
  "info",
  "view",
  "login",
  "logout",
  "whoami",
  "prune",
  "dedupe",
  "rebuild",
  "store",
  "cache",
  "import",
  "fetch",
  "patch",
  "patch-commit",
  "approve-builds",
  "licenses",
  "root",
  "bin",
  "prefix",
  "version",
  "help",
  "doctor",
  "setup",
  "env"
]);
var PM_FLAGS_WITH_ARG = new Map(Object.entries({
  npm: /* @__PURE__ */ new Set(["-w", "--workspace", "--prefix", "-C"]),
  pnpm: /* @__PURE__ */ new Set(["--filter", "-F", "-C", "--dir", "--workspace-concurrency", "--reporter"]),
  yarn: /* @__PURE__ */ new Set(["--cwd"]),
  bun: /* @__PURE__ */ new Set(["--filter", "-F", "--cwd"])
}));
var SUBCOMMAND_TOOLS = /* @__PURE__ */ new Set([
  ...PACKAGE_MANAGERS,
  ...GIT_PROGS,
  ...Object.keys(TEST_SUBCOMMAND),
  "docker",
  "kubectl",
  "make",
  "turbo",
  "nx",
  "lerna",
  "prisma",
  "drizzle-kit",
  "supabase",
  "atlas",
  "litestream",
  "goose",
  "knex",
  "sequelize",
  "typeorm",
  "rails",
  "rake",
  "uv",
  "poetry",
  "terraform",
  "helm",
  "systemctl",
  "zig",
  "gradle",
  "gradlew",
  "mvn",
  "mvnw"
]);
function programName(word) {
  const base = word.replaceAll("\\", "/").split("/").pop() ?? word;
  return base.replace(/\.(?:exe|cmd)$/i, "").toLowerCase();
}
var isFlag = (word) => word.startsWith("-") && word !== "-";
var nonFlags = (words) => words.filter((word) => !isFlag(word));
var firstNonFlag = (words) => words.find((word) => !isFlag(word));
function subcommandOf(prog, args) {
  const withArg = PM_FLAGS_WITH_ARG.get(prog);
  return withArg === void 0 ? firstNonFlag(args) : args[skipOptions(args, 0, withArg)];
}
function headOf(words) {
  const prog = programName(words[0] ?? "");
  const sub = subcommandOf(prog, words.slice(1));
  const head = SUBCOMMAND_TOOLS.has(prog) && sub !== void 0 && /^[a-z][a-z0-9:._-]*$/i.test(sub) ? `${prog} ${sub}` : prog;
  return head.length > HEAD_MAX ? head.slice(0, HEAD_MAX) : head;
}
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function skipOptions(words, start, withArg = /* @__PURE__ */ new Set()) {
  let i = start;
  while (i < words.length) {
    const word = words[i] ?? "";
    if (word === "--")
      return i + 1;
    if (!isFlag(word))
      return i;
    i += withArg.has(word) ? 2 : 1;
  }
  return i;
}
var SUDO_WITH_ARG = /* @__PURE__ */ new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "--user", "--group"]);
var TIMEOUT_WITH_ARG = /* @__PURE__ */ new Set(["-s", "-k", "--signal", "--kill-after"]);
var XARGS_WITH_ARG = /* @__PURE__ */ new Set(["-I", "-i", "-n", "-P", "-L", "-l", "-d", "-E", "-e", "-s", "-a", "--delimiter"]);
var NODE_WITH_ARG = /* @__PURE__ */ new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file", "-C"]);
function cleanStep(words) {
  const first = words[0];
  if (first === void 0)
    return null;
  if (ASSIGNMENT.test(first) || first === "{" || first === "}" || first === "!")
    return words.slice(1);
  const prog = programName(first);
  switch (prog) {
    case "sudo":
      return words.slice(skipOptions(words, 1, SUDO_WITH_ARG));
    case "env": {
      let i = skipOptions(words, 1, /* @__PURE__ */ new Set(["-u", "--unset", "-C", "--chdir", "-S"]));
      while (i < words.length && ASSIGNMENT.test(words[i] ?? ""))
        i++;
      return words.slice(i);
    }
    case "time":
    case "nohup":
    case "command":
    case "builtin":
    case "stdbuf":
      return words.slice(skipOptions(words, 1, /* @__PURE__ */ new Set(["-o", "-e", "-i"])));
    case "exec":
      return words.slice(skipOptions(words, 1, /* @__PURE__ */ new Set(["-a"])));
    case "nice":
      return words.slice(skipOptions(words, 1, /* @__PURE__ */ new Set(["-n", "--adjustment"])));
    case "timeout": {
      const i = skipOptions(words, 1, TIMEOUT_WITH_ARG);
      return words.slice(i + 1);
    }
    case "xargs":
      return words.slice(skipOptions(words, 1, XARGS_WITH_ARG));
    case "nyc":
    case "c8":
      return words.slice(skipOptions(words, 1, /* @__PURE__ */ new Set(["--reporter", "-r", "--include", "-n", "--exclude", "-x"])));
    case "npx":
    case "bunx":
    case "uvx":
      return words.slice(skipOptions(words, 1, /* @__PURE__ */ new Set(["--package", "-p", "--from"])));
    default:
      break;
  }
  const sub = words[1];
  if (prog === "pnpm" && (sub === "exec" || sub === "dlx") || prog === "yarn" && sub === "dlx" || prog === "bun" && sub === "x" || (prog === "uv" || prog === "poetry" || prog === "pipenv") && sub === "run" || prog === "bundle" && sub === "exec") {
    return words.slice(skipOptions(words, 2, /* @__PURE__ */ new Set(["--with", "--package"])));
  }
  return null;
}
function clean(words) {
  let current = words;
  for (let step = 0; step < MAX_CLEAN_STEPS; step++) {
    const next = cleanStep(current);
    if (next === null)
      return current;
    current = next;
  }
  return current;
}
function testFileRule(prog, args) {
  const scriptRunners = /* @__PURE__ */ new Set(["node", "bash", "sh", "python", "python3", "tsx", "ts-node"]);
  let rest = args;
  if (prog === "deno") {
    if (args[0] !== "run")
      return null;
    rest = args.slice(1);
  } else if (!scriptRunners.has(prog))
    return null;
  const i = skipOptions(rest, 0, NODE_WITH_ARG);
  const file = rest[i];
  if (file === void 0)
    return null;
  return TEST_FILE.test(programName(file)) ? { category: "test", rule: "shell.test.file" } : null;
}
function testRule(prog, args) {
  if (TEST_PROGS.has(prog))
    return { category: "test", rule: "shell.test.prog" };
  const sub = firstNonFlag(args.filter((word) => !word.startsWith("+")));
  if (sub !== void 0 && TEST_SUBCOMMAND.get(prog)?.has(sub))
    return { category: "test", rule: "shell.test.subcommand" };
  if (prog === "zig" && args[0] === "build" && args.includes("test"))
    return { category: "test", rule: "shell.test.subcommand" };
  if (prog === "node" && args.includes("--test"))
    return { category: "test", rule: "shell.test.node-test" };
  const moduleFlag = args.indexOf("-m");
  if ((prog === "python" || prog === "python3") && moduleFlag >= 0 && /^(?:pytest|unittest|nose2)$/.test(args[moduleFlag + 1] ?? "")) {
    return { category: "test", rule: "shell.test.python-module" };
  }
  const targets = nonFlags(args);
  if ((prog === "mvn" || prog === "mvnw") && targets.some((t) => ["test", "verify", "integration-test"].includes(t))) {
    return { category: "test", rule: "shell.test.build-tool" };
  }
  if ((prog === "gradle" || prog === "gradlew") && targets.some((t) => /(?:^|:)(?:test|check|connectedCheck)$/.test(t))) {
    return { category: "test", rule: "shell.test.build-tool" };
  }
  if (prog === "make" && targets.some((t) => ["test", "tests", "check"].includes(t))) {
    return { category: "test", rule: "shell.test.build-tool" };
  }
  if (prog === "rake" && targets.some((t) => t === "test" || t === "spec")) {
    return { category: "test", rule: "shell.test.build-tool" };
  }
  if (prog === "turbo") {
    const task = targets[0] === "run" ? targets[1] : targets[0];
    if (task?.startsWith("test"))
      return { category: "test", rule: "shell.test.monorepo" };
  }
  if (prog === "nx") {
    const hasTarget = args.some((a, i) => (a === "-t" || a === "--target" || a === "--targets") && args[i + 1] === "test" || /^--targets?=test$/.test(a));
    if (targets[0] === "test" || targets[0] === "run" && /:test$/.test(targets[1] ?? "") || hasTarget) {
      return { category: "test", rule: "shell.test.monorepo" };
    }
  }
  if (prog === "lerna" && targets[0] === "run" && targets[1] === "test")
    return { category: "test", rule: "shell.test.monorepo" };
  return testFileRule(prog, args);
}
function dbRule(prog, args) {
  if (DB_PROGS.has(prog))
    return { category: "db", rule: "shell.db.prog" };
  const sub = firstNonFlag(args) ?? "";
  const found = (set) => set.includes(sub) ? { category: "db", rule: "shell.db.subcommand" } : null;
  switch (prog) {
    case "goose":
      return args.some((a) => ["up", "down", "status", "create", "redo", "reset", "version", "fix"].includes(a)) ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "migrate":
      return args.some((a) => /^-(?:path|database|source)(?:=|$)/.test(a) || ["up", "down", "goto", "force"].includes(a)) ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "drizzle-kit":
      return found(["generate", "migrate", "push", "pull", "studio", "check"]);
    case "prisma":
      return found(["migrate", "db"]);
    case "supabase":
      return found(["db", "migration"]);
    case "atlas":
      return found(["schema", "migrate"]);
    case "litestream":
      return found(["restore", "replicate", "snapshots"]);
    case "knex":
      return /^(?:migrate|seed):/.test(sub) ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "sequelize":
      return sub.startsWith("db:") ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "typeorm":
      return /^(?:migration|schema):/.test(sub) ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "rails":
    case "rake":
      return sub.startsWith("db:") ? { category: "db", rule: "shell.db.subcommand" } : null;
    case "php":
      return programName(args[0] ?? "") === "artisan" && /^(?:migrate|db:)/.test(firstNonFlag(args.slice(1)) ?? "") ? { category: "db", rule: "shell.db.subcommand" } : null;
    default:
      break;
  }
  const managePy = prog === "manage.py" ? args : (prog === "python" || prog === "python3") && programName(args[0] ?? "") === "manage.py" ? args.slice(1) : null;
  if (managePy !== null) {
    const command = firstNonFlag(managePy) ?? "";
    if (["migrate", "makemigrations", "dbshell", "sqlmigrate", "loaddata", "dumpdata"].includes(command)) {
      return { category: "db", rule: "shell.db.subcommand" };
    }
  }
  return null;
}
function editRule(prog, args) {
  if (EDIT_PROGS.has(prog))
    return { category: "edit", rule: "shell.edit.prog" };
  const inPlace = (a) => a === "--in-place" || a.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(a) && !a.startsWith("--");
  if (prog === "sed" && args.some(inPlace)) {
    return { category: "edit", rule: "shell.edit.in-place" };
  }
  if (prog === "perl" && args.some((a) => /^-[a-zA-Z]*i/.test(a) && !a.startsWith("--") && !/^-[MIm]/.test(a))) {
    return { category: "edit", rule: "shell.edit.in-place" };
  }
  return null;
}
function writeRule(prog, args) {
  if (WRITE_PROGS.has(prog))
    return { category: "write", rule: "shell.write.prog" };
  if (prog === "tee" && nonFlags(args).some((file) => file !== "/dev/null"))
    return { category: "write", rule: "shell.write.tee" };
  return null;
}
function classifyProgram(prog, args) {
  return testRule(prog, args) ?? dbRule(prog, args) ?? (GIT_PROGS.has(prog) ? { category: "git", rule: "shell.git.prog" } : null) ?? (FETCH_PROGS.has(prog) ? { category: "fetch", rule: "shell.fetch.prog" } : null) ?? editRule(prog, args) ?? writeRule(prog, args) ?? (SEARCH_PROGS.has(prog) ? { category: "search", rule: "shell.search.prog" } : null) ?? (READ_PROGS.has(prog) ? { category: "read", rule: "shell.read.prog" } : null);
}
function packageManager(prog, args) {
  const withArg = PM_FLAGS_WITH_ARG.get(prog) ?? /* @__PURE__ */ new Set();
  let i = 0;
  while (i < args.length) {
    const word = args[i] ?? "";
    if (isFlag(word))
      i += withArg.has(word) ? 2 : 1;
    else if (prog === "yarn" && word === "workspace")
      i += 2;
    else if (prog === "yarn" && (word === "workspaces" || word === "foreach"))
      i += 1;
    else
      break;
  }
  const sub = args[i];
  if (sub === void 0)
    return null;
  const rest = args.slice(i + 1);
  let script;
  let explicitRun = false;
  if (sub === "run" || sub === "run-script" || sub === "rs") {
    script = firstNonFlag(rest);
    explicitRun = true;
  } else if (sub === "exec" || sub === "x" || sub === "dlx") {
    return { command: rest.slice(skipOptions(rest, 0)) };
  } else if (PM_BUILTINS.has(sub)) {
    return null;
  } else
    script = sub;
  if (script === void 0)
    return null;
  if (TEST_SCRIPT.test(script))
    return { match: { category: "test", rule: "shell.test.pm-script" } };
  if (DB_SCRIPT.test(script))
    return { match: { category: "db", rule: "shell.db.pm-script" } };
  if (!explicitRun && prog !== "npm")
    return { command: args.slice(i) };
  return null;
}
function shellInner(prog, args) {
  if (SHELLS.has(prog)) {
    for (let i = 0; i < args.length; i++) {
      const word = args[i] ?? "";
      if (!isFlag(word))
        return null;
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(word))
        return args[i + 1] ?? null;
    }
    return null;
  }
  if (POWERSHELLS.has(prog)) {
    const index = args.findIndex((word) => /^-(?:c|command)$/i.test(word));
    return index < 0 ? null : args.slice(index + 1).join(" ");
  }
  return null;
}
function classifyWords(words, depth) {
  const cleaned = clean(words);
  const first = cleaned[0];
  if (first === void 0)
    return [{ head: "", category: "neutral", rule: "shell.neutral" }];
  const prog = programName(first);
  const args = cleaned.slice(1);
  const inner = shellInner(prog, args);
  if (inner !== null && depth < MAX_UNWRAP_DEPTH)
    return classifySegmentsOf(inner, depth + 1);
  if (NEUTRAL.has(prog))
    return [{ head: prog, category: "neutral", rule: "shell.neutral" }];
  if (PACKAGE_MANAGERS.has(prog)) {
    const result = packageManager(prog, args);
    if (result !== null && "match" in result)
      return [{ head: headOf(cleaned), ...result.match }];
    if (result !== null && "command" in result && result.command.length > 0 && depth < MAX_UNWRAP_DEPTH) {
      const nested = classifyWords(result.command, depth + 1);
      if (nested.some((segment) => segment.category !== "neutral" && segment.category !== "shell"))
        return nested;
    }
  }
  const match = classifyProgram(prog, args);
  const head = headOf(cleaned);
  return [match === null ? { head, category: "shell", rule: "shell.none" } : { head, ...match }];
}
function classifySegmentsOf(command, depth) {
  let segments;
  try {
    segments = splitShell(command);
  } catch (error) {
    if (!(error instanceof ShellParseError))
      throw error;
    const words = command.trim().split(/\s+/).filter((word) => word !== "");
    return classifyWords(words, depth).map((segment) => ({ ...segment, rule: `${segment.rule}.unparsed` }));
  }
  const out = [];
  for (const segment of segments) {
    const classified = classifyWords(segment.words, depth);
    const writes = segment.writeTargets.some((target) => !["/dev/null", "/dev/stdout", "/dev/stderr"].includes(target));
    for (const item of classified) {
      if (writes && (item.category === "neutral" || rank(item.category) < rank("write"))) {
        out.push({ ...item, category: "write", rule: "shell.write.redirect" });
      } else
        out.push(item);
    }
  }
  return out;
}
function classifyShell(command) {
  const segments = classifySegmentsOf(command, 0);
  let best;
  for (const segment of segments) {
    if (segment.category === "neutral")
      continue;
    if (best === void 0 || rank(segment.category) > rank(best.category)) {
      best = segment;
    }
  }
  if (best === void 0 || best.category === "neutral") {
    return { category: "shell", rule: segments.length === 0 ? "shell.empty" : "shell.neutral", segments };
  }
  return { category: best.category, rule: best.rule, segments };
}

// ../core/dist/src/tools/classify-generic.js
var entry = (category, intent) => intent === void 0 ? { category } : { category, intent };
var CLAUDE_CODE = {
  Edit: entry("edit"),
  MultiEdit: entry("edit"),
  NotebookEdit: entry("edit"),
  Write: entry("write"),
  Read: entry("read"),
  Grep: entry("search"),
  Glob: entry("search"),
  ToolSearch: entry("search"),
  LS: entry("search"),
  WebFetch: entry("fetch"),
  WebSearch: entry("fetch"),
  Bash: entry("shell"),
  Monitor: entry("shell"),
  BashOutput: entry("shell"),
  KillShell: entry("shell"),
  Agent: entry("agent", "delegate"),
  Task: entry("agent", "delegate"),
  Workflow: entry("agent", "delegate"),
  SendMessage: entry("agent", "message"),
  ListAgents: entry("agent", "wait"),
  TaskOutput: entry("agent", "wait"),
  TaskStop: entry("agent", "wait"),
  AskUserQuestion: entry("other", "ask_human"),
  TaskCreate: entry("other", "plan"),
  TaskGet: entry("other", "plan"),
  TaskList: entry("other", "plan"),
  TaskUpdate: entry("other", "plan"),
  TodoWrite: entry("other", "plan"),
  ExitPlanMode: entry("other", "plan"),
  Skill: entry("other", "skill"),
  CronCreate: entry("other", "schedule"),
  CronDelete: entry("other", "schedule"),
  CronList: entry("other", "schedule"),
  ScheduleWakeup: entry("other", "schedule"),
  RemoteTrigger: entry("other", "schedule"),
  EnterWorktree: entry("git", "worktree"),
  ExitWorktree: entry("git", "worktree"),
  PushNotification: entry("other"),
  ReportFindings: entry("other"),
  DesignSync: entry("other")
};
var CODEX = {
  command_execution: entry("shell"),
  Bash: entry("shell"),
  apply_patch: entry("edit"),
  Edit: entry("edit"),
  Write: entry("write"),
  web_search: entry("fetch"),
  todo_list: entry("other", "plan"),
  reasoning: entry("other"),
  agent_message: entry("other")
};
var CODEX_COLLAB = {
  spawn_agent: entry("agent", "delegate"),
  send_input: entry("agent", "message"),
  wait: entry("agent", "wait"),
  close_agent: entry("agent", "wait")
};
var CURSOR = {
  readToolCall: entry("read"),
  Read: entry("read"),
  writeToolCall: entry("write"),
  Write: entry("write"),
  editToolCall: entry("edit"),
  deleteToolCall: entry("edit"),
  Delete: entry("edit"),
  shellToolCall: entry("shell"),
  Shell: entry("shell"),
  grepToolCall: entry("search"),
  globToolCall: entry("search"),
  lsToolCall: entry("search"),
  Grep: entry("search"),
  todoToolCall: entry("other", "plan"),
  updateTodosToolCall: entry("other", "plan"),
  Task: entry("agent", "delegate")
};
var AGY = {
  run_command: entry("shell"),
  write_to_file: entry("write"),
  ask_permission: entry("other", "ask_human")
};
var OPENROUTER = {
  read_file: entry("read"),
  write_file: entry("write"),
  edit_file: entry("edit"),
  list_dir: entry("search"),
  glob: entry("search"),
  grep: entry("search"),
  bash: entry("shell")
};
var TABLES = {
  "claude-code": { prefix: "cc", table: CLAUDE_CODE },
  codex: { prefix: "codex", table: CODEX },
  cursor: { prefix: "cursor", table: CURSOR },
  agy: { prefix: "agy", table: AGY },
  openrouter: { prefix: "openrouter", table: OPENROUTER }
};
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
function shellCommandOf(input) {
  if (!isRecord3(input))
    return typeof input === "string" ? input : void 0;
  for (const key of ["command", "CommandLine", "cmd"]) {
    const value = input[key];
    if (typeof value === "string")
      return value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
      return value.map((part) => /^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", `'\\''`)}'`).join(" ");
    }
  }
  return void 0;
}
function withShell(base, input) {
  const command = shellCommandOf(input);
  if (command === void 0)
    return base;
  const shell = classifyShell(command);
  const decisive = shell.segments.find((segment) => segment.rule === shell.rule) ?? shell.segments[0];
  const result = { ...base, category: shell.category, rule: shell.rule };
  if (decisive !== void 0 && decisive.head !== "")
    result.commandHead = decisive.head;
  return result;
}
function parseMcpToolName(name) {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    if (separator <= 0 || separator + 2 >= rest.length)
      return null;
    return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
  }
  if (name.startsWith("MCP:") && name.length > 4)
    return { server: "", tool: name.slice(4) };
  return null;
}
function mcpClassification(mcp, bus) {
  const isBus = bus.busServer !== void 0 && mcp.server === bus.busServer;
  const intent = isBus ? own(BUS_TOOL_INTENTS, mcp.tool) : void 0;
  if (intent !== void 0)
    return { category: "mcp", intent, rule: `mcp.bus.${mcp.tool}`, mcp };
  return { category: "mcp", rule: "mcp.prefix", mcp };
}
function toolNameWords(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ").split(/[\s_.:-]+/).filter((word) => word !== "").map((word) => word.toLowerCase());
}
var FALLBACK = [
  { category: "shell", test: (w) => w.some((x) => ["bash", "shell", "command", "exec", "terminal"].includes(x)) },
  { category: "edit", test: (w) => w.some((x) => ["edit", "patch", "replace"].includes(x)) },
  {
    category: "write",
    test: (w) => w.includes("write") || w.includes("save") || w.includes("create") && w.includes("file")
  },
  {
    category: "read",
    test: (w) => w.includes("read") || w.includes("view") || w.includes("open") && w.includes("file")
  },
  { category: "search", test: (w) => w.some((x) => ["grep", "glob", "search", "find", "list", "ls"].includes(x)) },
  { category: "fetch", test: (w) => w.some((x) => ["fetch", "web", "url", "http", "browse"].includes(x)) },
  {
    category: "agent",
    intent: "delegate",
    test: (w) => w.some((x) => ["agent", "subagent", "delegate"].includes(x))
  }
];
function classifyByName(name, input) {
  const words = toolNameWords(name);
  for (const candidate of FALLBACK) {
    if (!candidate.test(words))
      continue;
    const base = { category: candidate.category, rule: `fallback.name.${candidate.category}` };
    if (candidate.intent !== void 0)
      base.intent = candidate.intent;
    if (candidate.category !== "shell")
      return base;
    const shell = withShell(base, input);
    return shell === base ? base : { ...shell, rule: `fallback.${shell.rule}` };
  }
  return { category: "other", rule: "fallback.name.other" };
}
function fromEntry(found, rule, input) {
  const base = { category: found.category, rule };
  if (found.intent !== void 0)
    base.intent = found.intent;
  return found.category === "shell" ? withShell(base, input) : base;
}
function classifyCodexItem(o, bus) {
  const input = isRecord3(o.input) ? o.input : {};
  if (o.toolName === "file_change") {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    const allAdded = changes.length > 0 && changes.every((change) => isRecord3(change) && change.kind === "add");
    return {
      category: allAdded ? "write" : "edit",
      rule: allAdded ? "codex.item.file_change.add" : "codex.item.file_change"
    };
  }
  if (o.toolName === "collab_tool_call") {
    const tool = typeof input.tool === "string" ? input.tool : "";
    const found = own(CODEX_COLLAB, tool);
    return found === void 0 ? { category: "agent", rule: "codex.item.collab_tool_call" } : fromEntry(found, `codex.collab.${tool}`, void 0);
  }
  if (o.toolName === "mcp_tool_call") {
    const server = typeof input.server === "string" ? input.server : o.mcp?.server ?? "";
    const tool = typeof input.tool === "string" ? input.tool : o.mcp?.tool ?? "";
    const result = mcpClassification({ server, tool }, bus);
    return { ...result, rule: result.rule === "mcp.prefix" ? "codex.item.mcp_tool_call" : result.rule };
  }
  return null;
}
function classifyCursorKey(o) {
  if (o.toolName === "function") {
    const input = isRecord3(o.input) ? o.input : {};
    const name = typeof input.name === "string" ? input.name : "";
    const args = typeof input.arguments === "string" ? safeJson(input.arguments) : input.arguments;
    return name === "" ? { category: "other", rule: "fallback.name.other" } : classifyByName(name, args);
  }
  if (o.toolName.endsWith("ToolCall")) {
    const bare = o.toolName.slice(0, -"ToolCall".length);
    if (/mcp/i.test(bare))
      return { category: "mcp", rule: "cursor.key.mcp" };
    return classifyByName(bare, o.input);
  }
  return null;
}
function safeJson(text2) {
  try {
    return JSON.parse(text2);
  } catch {
    return void 0;
  }
}
function classifyToolWith(o, bus) {
  const runtimeTable = own(TABLES, o.runtime);
  if (o.runtime === "codex") {
    const item = classifyCodexItem(o, bus);
    if (item !== null)
      return item;
  }
  const found = runtimeTable === void 0 ? void 0 : own(runtimeTable.table, o.toolName);
  if (runtimeTable !== void 0 && found !== void 0) {
    return fromEntry(found, `${runtimeTable.prefix}.name.${o.toolName}`, o.input);
  }
  const mcp = o.mcp ?? parseMcpToolName(o.toolName);
  if (mcp !== null && mcp !== void 0)
    return mcpClassification(mcp, bus);
  if (o.runtime === "cursor") {
    const key = classifyCursorKey(o);
    if (key !== null)
      return key;
  }
  return classifyByName(o.toolName, o.input);
}

// src/mappers/tool.ts
var PATH_KEYS = ["file_path", "path", "notebook_path"];
var INPUT_KEYS = [
  ...PATH_KEYS,
  "paths",
  "pattern",
  "query",
  "description",
  "url",
  "subagent_type",
  "command",
  "CommandLine",
  "cmd",
  "changes",
  "tool",
  "server",
  "name",
  "arguments"
];
var WRITE_CATEGORIES = /* @__PURE__ */ new Set(["edit", "write"]);
var MENTION_CATEGORIES = /* @__PURE__ */ new Set(["read", "search", "shell", "test", "git", "db"]);
var FREE_TEXT = PAYLOAD.freeTextMaxChars;
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item !== "") : [];
}
function boundedInput(value, budget = { left: PAYLOAD.inputNodesMax }, depth = 0) {
  budget.left--;
  if (typeof value === "string") return cutText(value, FREE_TEXT);
  if (Array.isArray(value)) {
    if (depth >= EVENT_LIMITS.dataDepth) return DEPTH_MARKER;
    const out = [];
    let left = FREE_TEXT;
    for (const item of value) {
      if (left <= 0 || budget.left <= 0) break;
      const bounded = typeof item === "string" ? cutText(item, left) : boundedInput(item, budget, depth + 1);
      if (typeof item === "string") budget.left--;
      left -= typeof bounded === "string" ? Math.max(1, bounded.length) : 1;
      out.push(bounded);
    }
    return out;
  }
  if (isRecord(value)) {
    if (depth >= EVENT_LIMITS.dataDepth) return DEPTH_MARKER;
    const entries = [];
    for (const key in value) {
      if (budget.left <= 0) break;
      if (!Object.hasOwn(value, key)) continue;
      entries.push([cutText(key, FREE_TEXT), boundedInput(value[key], budget, depth + 1)]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}
function projectInput(input) {
  const budget = { left: PAYLOAD.inputNodesMax };
  if (!isRecord(input)) return boundedInput(input, budget);
  const entries = [];
  for (const key of INPUT_KEYS) {
    if (budget.left <= 0) break;
    if (Object.hasOwn(input, key)) entries.push([key, boundedInput(input[key], budget, 1)]);
  }
  return Object.fromEntries(entries);
}
function describeTool(call, detail) {
  const name = clip(call.name, 128);
  if (name === void 0) return null;
  const original = isRecord(call.input) ? call.input : {};
  const projected = projectInput(call.input);
  const input = isRecord(projected) ? projected : {};
  const classification = classifyToolWith(
    { runtime: call.runtime, toolName: name, input: projected },
    { busServer: call.busServer }
  );
  const path = firstText(input, PATH_KEYS);
  const paths = stringList(input.paths);
  const pathsCount = stringList(original.paths).length;
  const command = clip(shellCommandOf(projected), FREE_TEXT);
  const pattern = firstText(input, ["pattern", "query"]);
  const target = compact({
    path,
    paths_count: pathsCount > 0 ? pathsCount : void 0,
    command,
    command_head: classification.commandHead,
    description: text(input.description),
    url: text(input.url),
    pattern,
    subagent_type: text(input.subagent_type),
    mcp: classification.mcp,
    content_bytes: typeof original.content === "string" ? byteLength(original.content) : void 0
  });
  const fields = compact({
    tool_name: name,
    tool_category: classification.category,
    tool_intent: classification.intent,
    category_source: "origin",
    classifier_rule: clip(classification.rule, 48),
    tool_use_id: clip(call.useId, 128),
    target: Object.keys(target).length > 0 ? target : void 0,
    input_preview: detail === "verbose" ? cutText(JSON.stringify(dropNeverExported(boundedInput(call.input)) ?? null), FREE_TEXT) : void 0
  });
  const located = [...path === void 0 ? [] : [path], ...paths];
  const mentionable = command !== void 0 || MENTION_CATEGORIES.has(classification.category);
  const facts = {
    category: classification.category,
    writePaths: WRITE_CATEGORIES.has(classification.category) ? located : [],
    mentions: mentionable ? [...located, ...command === void 0 ? [] : [command], ...pattern === void 0 ? [] : [pattern]] : []
  };
  return { fields, category: classification.category, facts, input: projected };
}

// src/mappers/common.ts
function promptSubmit(prompt, context) {
  const value = typeof prompt === "string" ? prompt : "";
  return {
    type: "prompt.submit",
    data: compact({
      origin: "human",
      chars: [...value].length,
      sha256_12: value === "" ? void 0 : context.sha256Hex(value).slice(0, 12),
      preview: context.detail === "verbose" && value !== "" ? cutText(value, PAYLOAD.freeTextMaxChars) : void 0
    })
  };
}
var SESSION_TRIGGERS = /* @__PURE__ */ new Set(["startup", "resume", "clear", "compact", "fork"]);
function sessionTrigger(value) {
  return typeof value === "string" && SESSION_TRIGGERS.has(value) ? value : "unknown";
}
var COMPACT_TRIGGERS = /* @__PURE__ */ new Set(["manual", "auto"]);
function compactTrigger(value) {
  return typeof value === "string" && COMPACT_TRIGGERS.has(value) ? value : "unknown";
}
function limitKindFromText(message) {
  const lower = (message ?? "").toLowerCase();
  if (lower.includes("weekly limit")) return "subscription_weekly";
  if (lower.includes("session limit")) return "subscription_window";
  if (/\b(?:opus|sonnet|haiku|fable) limit\b/.test(lower)) return "model_limit";
  if (lower.includes("spend limit")) return "spend_cap";
  return "unknown";
}
function looksLikeQuota(message) {
  return /\b(?:quota|rate[ _-]?limit|resource[ _-]?exhausted|usage limit|too many requests)\b/i.test(message ?? "");
}
var SUBAGENT_STATUS = {
  completed: "completed",
  success: "completed",
  succeeded: "completed",
  failed: "failed",
  error: "failed",
  stopped: "stopped",
  cancelled: "stopped",
  canceled: "stopped",
  aborted: "stopped",
  killed: "killed"
};
function subagentStatus(value) {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return Object.hasOwn(SUBAGENT_STATUS, key) ? SUBAGENT_STATUS[key] ?? "unknown" : "unknown";
}
function roleFromAgentType(agentType) {
  if (agentType === void 0) return void 0;
  return clip(agentType.replace(/-(?:opus|sonnet|fable|haiku)$/, ""), 64);
}
function toolEvent(type, call, detail, extra) {
  const described = describeTool(call, detail);
  if (described === null) return null;
  return { draft: { type, data: compact({ ...described.fields, ...extra }) }, tool: described.facts };
}
function permissionRequest(call, context, sessionId, suggestions) {
  const described = describeTool(call, context.detail);
  if (described === null) return null;
  const fingerprint = [
    sessionId ?? "",
    new Date(context.tsMs).toISOString(),
    String(described.fields.tool_name),
    canonicalJson(described.input ?? null)
  ].join("");
  const data = compact({
    request_id: `hook_${context.sha256Hex(fingerprint).slice(0, 24)}`,
    mechanism: "hook",
    tool_name: described.fields.tool_name,
    tool_category: described.fields.tool_category,
    tool_use_id: described.fields.tool_use_id,
    target: described.fields.target,
    suggestions_count: Array.isArray(suggestions) ? suggestions.length : void 0
  });
  return { draft: { type: "permission.request", data }, tool: described.facts };
}
function turnEnd(extra = {}) {
  return { type: "notification", data: compact({ kind: "turn_end", ...extra }) };
}
function sessionEnd(status, reason, extra = {}) {
  return { type: "session.end", data: compact({ status, reason: clip(reason, 48), ...extra }) };
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value;
    const entries = Object.keys(record).filter((key) => record[key] !== void 0).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// src/envelope.ts
function agentOf(facts) {
  const sub = facts.subagent;
  if (sub !== void 0 && (sub.id !== void 0 || sub.type !== void 0)) {
    return compact({
      name: roleFromAgentType(sub.type) ?? "subagent",
      type: clip(sub.type, 128),
      instance_id: printable(sub.id, 128),
      parent_instance_id: "main"
    });
  }
  return { name: clip(facts.role, 64) ?? "main" };
}
function envelope(draft, context, eventId, ts) {
  const data = context.taskSource === void 0 ? draft.data : { ...draft.data, task_source: context.taskSource };
  return compact({
    schema: SCHEMA_V1,
    event_id: eventId,
    ts,
    type: draft.type,
    source: compact({ kind: "hook", runtime: context.runtime, runtime_version: context.runtimeVersion }),
    project: compact({ ...context.project }),
    task_id: context.taskId,
    session_id: context.sessionId,
    run_id: context.runId,
    agent: context.agent,
    provider: context.runtime,
    model: context.model,
    data
  });
}
function buildEvents(drafts, context, sanitize, nextId, ts) {
  return drafts.map(
    (draft) => sanitizeEvent(envelope(draft, context, nextId(), ts), { paths: sanitize.paths, detail: sanitize.detail })
  );
}

// src/mappers/agy.ts
function errorText(value) {
  if (isRecord(value)) return text(value.message) ?? text(value.error) ?? boundedJson(value);
  return text(value);
}
function stopEvent(p) {
  const reason = clip(p.terminationReason, 48);
  if (reason === "error") {
    const message = errorText(p.error);
    if (looksLikeQuota(message)) {
      return {
        type: "limit.hit",
        data: compact({ limit_kind: limitKindFromText(message), detected_from: "stop_failure", message })
      };
    }
    return {
      type: "error",
      data: compact({ scope: "runtime", code: "agy_error", fatal: true, message, hook_event: "Stop" })
    };
  }
  return turnEnd({ termination_reason: reason });
}
var mapAgy = (context) => {
  const p = context.payload;
  const paths = Array.isArray(p.workspacePaths) ? p.workspacePaths : [];
  const conversationId = printable(p.conversationId, 128);
  const mapped = {
    events: [],
    sessionId: conversationId,
    model: printable(p.modelName, 128),
    cwd: text(paths[0])
  };
  const toolCall = isRecord(p.toolCall) ? p.toolCall : {};
  const step = count(p.stepIdx);
  const useId = conversationId !== void 0 && step !== void 0 ? `${conversationId}${step}` : void 0;
  const call = {
    runtime: context.runtime,
    name: toolCall.name,
    input: toolCall.args,
    useId,
    busServer: context.busServer
  };
  const withTool = (result) => result === null ? mapped : { ...mapped, events: [result.draft], tool: result.tool };
  switch (context.event) {
    case "PreToolUse":
      return withTool(toolEvent("tool.pre", call, context.detail, {}));
    case "PostToolUse": {
      const error = errorText(p.error);
      return error === void 0 ? withTool(toolEvent("tool.post", call, context.detail, {})) : withTool(toolEvent("tool.fail", call, context.detail, { error_kind: "error", error }));
    }
    case "Stop":
      mapped.events.push(stopEvent(p));
      return mapped;
    default:
      return mapped;
  }
};

// src/mappers/claude-code.ts
import { posix, win32 } from "node:path";

// src/mappers/pointer.ts
var MAX_SCAN_CHARS = 64 * 1024;
var FENCE = /```([A-Za-z]*)[ \t]*\r?\n([\s\S]*?)```/g;
var LOOKS_LIKE_POINTER = /["']?(?:agent|next_agent)["']?\s*:/;
var HAS_STATUS = /["']?status["']?\s*:/;
var RUNTIME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
var CHECKPOINT = HANDOFF_POINTER_STATUS[3];
function looksLikePointer(block) {
  return LOOKS_LIKE_POINTER.test(block) && HAS_STATUS.test(block);
}
var MAX_OBJECT_CHARS = 16 * 1024;
var MAX_CANDIDATES = 256;
function matchingBrace(source, start) {
  let depth = 0;
  let inString = false;
  const limit = Math.min(source.length, start + MAX_OBJECT_CHARS);
  for (let i = start; i < limit; i++) {
    const char = source[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function lastBareJsonPointer(source) {
  let start = source.lastIndexOf("{");
  for (let tries = 0; start !== -1 && tries < MAX_CANDIDATES; tries++) {
    const end = matchingBrace(source, start);
    if (end !== -1) {
      const candidate = source.slice(start, end + 1);
      if (looksLikePointer(candidate)) return candidate;
    }
    start = start === 0 ? -1 : source.lastIndexOf("{", start - 1);
  }
  return null;
}
function lastFencedPointer(source) {
  let found = null;
  for (const match of source.matchAll(FENCE)) {
    const lang = (match[1] ?? "").toLowerCase();
    const body = (match[2] ?? "").trim();
    if (["", "json", "yaml", "yml"].includes(lang) && looksLikePointer(body)) found = { body, lang };
  }
  return found;
}
function stringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const items = value.filter((item) => typeof item === "string");
  return items.length === value.length ? items : void 0;
}
function needsHuman(value) {
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) return void 0;
  const question = text(value.question);
  if (question === void 0) return void 0;
  return compact({
    question,
    options: stringArray(value.options),
    blocking: typeof value.blocking === "boolean" ? value.blocking : void 0
  });
}
function wireStatusFields(status, artifactPath) {
  if (status === CHECKPOINT) return artifactPath === void 0 ? {} : { checkpoint: true };
  return status !== void 0 && POINTER_STATUS.includes(status) ? { status } : {};
}
function normalizedFields(pointer) {
  const artifactPath = text(pointer.artifact_path);
  const provider = text(pointer.provider) ?? text(pointer.provider_used);
  const taskId = text(pointer.task_id);
  return compact({
    agent: text(pointer.agent),
    model: text(pointer.model) ?? text(pointer.model_used),
    provider: provider !== void 0 && RUNTIME_ID.test(provider) ? provider : void 0,
    task_id: taskId !== void 0 && GENERIC_TASK_ID.test(taskId) ? taskId : void 0,
    ...wireStatusFields(text(pointer.status), artifactPath),
    artifact_path: artifactPath,
    files_changed: stringArray(pointer.files_changed),
    next_agent: text(pointer.next_agent),
    context_for_next: text(pointer.context_for_next),
    blockers: stringArray(pointer.blockers),
    skill_candidates: stringArray(pointer.skill_candidates),
    needs_human: needsHuman(pointer.needs_human)
  });
}
function statusErrors(pointer, fields) {
  if (fields.status !== void 0 || fields.checkpoint === true) return [];
  return text(pointer.status) === CHECKPOINT ? ["checkpoint_requires_artifact_path"] : ["invalid_status"];
}
function extractPointer(message) {
  const source = message.length > MAX_SCAN_CHARS ? message.slice(-MAX_SCAN_CHARS) : message;
  const fenced = lastFencedPointer(source);
  const raw = fenced?.body ?? lastBareJsonPointer(source);
  if (raw === null) return null;
  if (fenced !== null && (fenced.lang === "yaml" || fenced.lang === "yml")) {
    return { raw, fields: {}, valid: false, errors: ["yaml_not_parsed_at_origin"] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw, fields: {}, valid: false, errors: ["not_json"] };
  }
  if (!isRecord(parsed)) return { raw, fields: {}, valid: false, errors: ["not_object"] };
  const fields = normalizedFields(parsed);
  const errors = [...fields.agent === void 0 ? ["missing_agent"] : [], ...statusErrors(parsed, fields)];
  return { raw, fields, valid: errors.length === 0, errors };
}
function lastAssistantText(tail) {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line === void 0 || line === "") continue;
    let entry2;
    try {
      entry2 = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry2) || entry2.type !== "assistant" || !isRecord(entry2.message)) continue;
    const content = entry2.message.content;
    if (!Array.isArray(content)) continue;
    const texts = content.filter(
      (block) => isRecord(block) && block.type === "text" && typeof block.text === "string"
    ).map((block) => block.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return null;
}

// src/mappers/claude-code.ts
var AGENT_TOOLS = /* @__PURE__ */ new Set(["Agent", "Task"]);
function effortOf(value) {
  return clip(isRecord(value) ? value.level : value, 16);
}
function resultSummary(response) {
  if (!isRecord(response) || !Array.isArray(response.structuredPatch)) return void 0;
  let added = 0;
  let removed = 0;
  for (const hunk of response.structuredPatch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
    for (const line of hunk.lines) {
      if (typeof line !== "string") continue;
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { lines_added: added, lines_removed: removed, files_changed: 1 };
}
function tokensOf(usage) {
  const tokens = compact({
    input: count(usage.input_tokens),
    cache_read: count(usage.cache_read_input_tokens),
    cache_write: count(usage.cache_creation_input_tokens),
    output: count(usage.output_tokens)
  });
  const values = Object.values(tokens).filter((value) => typeof value === "number");
  if (values.length > 0) tokens.total = values.reduce((sum, value) => sum + value, 0);
  const raw = {};
  for (const [key, value] of Object.entries(usage)) {
    if (Object.keys(raw).length >= 20) break;
    if (key.length <= 64 && integer(value) !== void 0) raw[key] = value;
  }
  return { tokens, raw };
}
function agentResultEvents(p) {
  const response = p.tool_response;
  const toolUseId = clip(p.tool_use_id, 128);
  if (!AGENT_TOOLS.has(String(p.tool_name)) || !isRecord(response) || response.status !== "completed") return [];
  const agentId = clip(response.agentId, 128);
  if (agentId === void 0 && toolUseId === void 0) return [];
  const input = isRecord(p.tool_input) ? p.tool_input : {};
  const agentType = clip(input.subagent_type, 128);
  const events = [
    {
      type: "subagent.stop",
      data: compact({
        agent_id: agentId,
        parent_tool_use_id: toolUseId,
        agent_type: agentType,
        role: roleFromAgentType(agentType),
        status: "completed",
        duration_ms: count(response.totalDurationMs),
        tool_uses: count(response.totalToolUseCount),
        tokens_total: count(response.totalTokens),
        model_resolved: clip(response.resolvedModel, 128)
      })
    }
  ];
  if (isRecord(response.usage)) {
    const { tokens, raw } = tokensOf(response.usage);
    events.push({
      type: "usage.report",
      data: compact({
        scope: "subagent",
        cumulative: true,
        includes_subagents: false,
        billing: "unknown",
        tokens,
        tokens_raw: Object.keys(raw).length > 0 ? raw : void 0,
        cost_kind: "none",
        // Chave natural por subagente: sem ela, dois subagentes da mesma execução colidiriam.
        message_id: toolUseId ?? agentId
      })
    });
  }
  return events;
}
function notificationKind(p) {
  const declared = text(p.notification_type);
  if (declared !== void 0 && /^[a-z][a-z0-9_]{0,47}$/.test(declared)) return declared;
  const message = (freeText(p.message) ?? "").toLowerCase();
  if (message.includes("permission")) return "permission_prompt";
  if (/waiting for (?:your )?input|\bidle\b/.test(message)) return "idle_prompt";
  return "info";
}
function stopFailure(p) {
  const code = freeText(p.error);
  const message = freeText(firstText(p, ["error_message", "message", "error_details", "details"]));
  if (code === "rate_limit" || looksLikeQuota(message)) {
    return {
      type: "limit.hit",
      data: compact({
        limit_kind: limitKindFromText(message ?? code),
        detected_from: "stop_failure",
        error_code: clip(code, 64),
        message
      })
    };
  }
  return {
    type: "error",
    data: compact({
      scope: "runtime",
      code: clip(code, 64) ?? "stop_failure",
      fatal: true,
      message,
      hook_event: "StopFailure"
    })
  };
}
function isAbsoluteOn(platform, path) {
  return (platform === "win32" ? win32 : posix).isAbsolute(path);
}
function subagentFinalMessage(p, context) {
  const direct = text(p.last_assistant_message);
  if (direct !== void 0) return direct;
  const path = text(p.agent_transcript_path);
  if (path === void 0 || !isAbsoluteOn(context.platform, path) || !path.endsWith(".jsonl")) return null;
  const tail = context.readTail(path, PAYLOAD.transcriptTailBytes);
  return tail === null ? null : lastAssistantText(tail);
}
function subagentStop(p, context, agentId, agentType) {
  const events = [
    {
      type: "subagent.stop",
      data: compact({
        agent_id: agentId,
        agent_type: agentType,
        role: roleFromAgentType(agentType),
        status: "completed"
      })
    }
  ];
  const message = subagentFinalMessage(p, context);
  const pointer = message === null ? null : extractPointer(message);
  if (pointer !== null) {
    events.push({
      type: "handoff.pointer",
      data: compact({
        ...pointer.fields,
        source: "subagent_stop",
        valid: pointer.valid,
        validation_errors: pointer.errors.length > 0 ? pointer.errors : void 0,
        raw: pointer.raw
      })
    });
  }
  return events;
}
var mapClaudeCode = (context) => {
  const p = context.payload;
  const sessionId = printable(p.session_id, 128);
  const agentId = clip(p.agent_id, 128);
  const agentType = clip(p.agent_type, 128);
  const mapped = {
    events: [],
    sessionId,
    model: printable(p.model, 128),
    cwd: text(p.cwd) ?? context.env.claudeProjectDir,
    subagent: agentId !== void 0 || agentType !== void 0 ? { id: agentId, type: agentType } : void 0
  };
  const call = {
    runtime: context.runtime,
    name: p.tool_name,
    input: p.tool_input,
    useId: p.tool_use_id,
    busServer: context.busServer
  };
  const withTool = (result, extra = []) => result === null ? mapped : { ...mapped, events: [result.draft, ...extra], tool: result.tool };
  switch (context.event) {
    case "SessionStart":
      mapped.events.push({
        type: "session.start",
        data: compact({
          trigger: sessionTrigger(p.source),
          permission_mode: clip(p.permission_mode, 32),
          effort: effortOf(p.effort)
        })
      });
      return mapped;
    case "SessionEnd":
      mapped.events.push(sessionEnd("unknown", p.reason));
      return mapped;
    case "UserPromptSubmit":
      mapped.events.push(promptSubmit(p.prompt, context));
      return mapped;
    case "PreToolUse":
      return withTool(toolEvent("tool.pre", call, context.detail, {}));
    case "PostToolUse": {
      const response = p.tool_response;
      return withTool(
        toolEvent("tool.post", call, context.detail, {
          duration_ms: count(p.duration_ms),
          output_bytes: response === void 0 ? void 0 : byteLength(response),
          interrupted: isRecord(response) ? bool(response.interrupted) : void 0,
          result_summary: resultSummary(response)
        }),
        agentResultEvents(p)
      );
    }
    case "PostToolUseFailure":
      return withTool(
        toolEvent("tool.fail", call, context.detail, {
          duration_ms: count(p.duration_ms),
          error_kind: p.is_interrupt === true ? "interrupted" : "error",
          error: freeText(p.error)
        })
      );
    case "PermissionRequest":
      return withTool(permissionRequest(call, context, sessionId, p.permission_suggestions));
    case "PermissionDenied":
      mapped.events.push({
        type: "permission.resolved",
        data: compact({
          decision: "deny",
          decided_by: "rule",
          tool_name: clip(p.tool_name, 128),
          tool_use_id: clip(p.tool_use_id, 128)
        })
      });
      return mapped;
    case "Notification":
      mapped.events.push({
        type: "notification",
        data: compact({ kind: notificationKind(p), message: freeText(p.message) })
      });
      return mapped;
    case "Stop":
      mapped.events.push(turnEnd());
      return mapped;
    case "StopFailure":
      mapped.events.push(stopFailure(p));
      return mapped;
    case "SubagentStart":
      if (agentId !== void 0) {
        mapped.events.push({
          type: "subagent.start",
          data: compact({ agent_id: agentId, agent_type: agentType ?? "unknown", role: roleFromAgentType(agentType) })
        });
      }
      return mapped;
    case "SubagentStop":
      if (agentId !== void 0) mapped.events.push(...subagentStop(p, context, agentId, agentType));
      return mapped;
    case "PreCompact":
    case "PostCompact":
      mapped.events.push({
        type: "compact",
        data: { phase: context.event === "PreCompact" ? "pre" : "post", trigger: compactTrigger(p.trigger) }
      });
      return mapped;
    default:
      return mapped;
  }
};

// src/mappers/codex.ts
function subagentIds(p, agentType) {
  const agentId = clip(p.agent_id, 128);
  const parentToolUseId = clip(p.tool_use_id, 128);
  if (agentId !== void 0 || parentToolUseId !== void 0) {
    return compact({ agent_id: agentId, parent_tool_use_id: parentToolUseId });
  }
  const turnId = clip(p.turn_id, 64);
  return turnId === void 0 ? null : { agent_id: clip(`${turnId}/${agentType ?? "subagent"}`, 128) };
}
var mapCodex = (context) => {
  const p = context.payload;
  const sessionId = printable(p.session_id, 128);
  const mapped = { events: [], sessionId, model: printable(p.model, 128), cwd: text(p.cwd) };
  const call = {
    runtime: context.runtime,
    name: p.tool_name,
    input: p.tool_input,
    useId: p.tool_use_id,
    busServer: context.busServer
  };
  const withTool = (result) => result === null ? mapped : { ...mapped, events: [result.draft], tool: result.tool };
  switch (context.event) {
    case "SessionStart":
      mapped.events.push({ type: "session.start", data: { trigger: sessionTrigger(p.source) } });
      return mapped;
    case "SessionEnd":
      mapped.events.push(sessionEnd("unknown", p.reason));
      return mapped;
    case "UserPromptSubmit":
      mapped.events.push(promptSubmit(p.prompt, context));
      return mapped;
    case "PreToolUse":
      return withTool(toolEvent("tool.pre", call, context.detail, {}));
    case "PostToolUse":
      return withTool(
        toolEvent("tool.post", call, context.detail, {
          duration_ms: count(p.duration_ms),
          output_bytes: p.tool_response === void 0 ? void 0 : byteLength(p.tool_response)
        })
      );
    case "PermissionRequest":
      return withTool(permissionRequest(call, context, sessionId, p.permission_suggestions));
    case "SubagentStart":
    case "SubagentStop": {
      const agentType = clip(p.agent_type, 128);
      const ids = subagentIds(p, agentType);
      if (ids === null) return mapped;
      const role = roleFromAgentType(agentType);
      mapped.events.push(
        context.event === "SubagentStart" ? { type: "subagent.start", data: compact({ ...ids, agent_type: agentType ?? "unknown", role }) } : {
          type: "subagent.stop",
          data: compact({ ...ids, agent_type: agentType, role, status: subagentStatus(p.status) })
        }
      );
      mapped.subagent = { type: agentType };
      return mapped;
    }
    case "PreCompact":
    case "PostCompact":
      mapped.events.push({
        type: "compact",
        data: { phase: context.event === "PreCompact" ? "pre" : "post", trigger: compactTrigger(p.trigger) }
      });
      return mapped;
    case "Stop":
      mapped.events.push(turnEnd());
      return mapped;
    case "Interrupt":
      mapped.events.push({ type: "notification", data: { kind: "interrupted" } });
      return mapped;
    default:
      return mapped;
  }
};

// src/mappers/cursor.ts
var SESSION_STATUS = {
  completed: "success",
  success: "success",
  error: "error",
  failed: "error",
  aborted: "canceled",
  cancelled: "canceled",
  canceled: "canceled",
  interrupted: "interrupted"
};
function sessionStatus(value) {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return Object.hasOwn(SESSION_STATUS, key) ? SESSION_STATUS[key] ?? "unknown" : "unknown";
}
var FAILURE_KINDS = /* @__PURE__ */ new Set(["error", "timeout", "permission_denied"]);
var EVENT_TOOL = { beforeShellExecution: "Shell", beforeReadFile: "Read" };
function toolInputOf(p) {
  if (p.tool_input !== void 0) return p.tool_input;
  if (typeof p.command === "string") return { command: p.command };
  if (typeof p.file_path === "string") return { file_path: p.file_path };
  return void 0;
}
function subagentIds2(p) {
  const agentId = clip(p.agent_id, 128) ?? clip(p.subagent_id, 128) ?? clip(p.generation_id, 128);
  const parentToolUseId = clip(p.tool_use_id, 128);
  if (agentId === void 0 && parentToolUseId === void 0) return null;
  return compact({ agent_id: agentId, parent_tool_use_id: parentToolUseId });
}
var mapCursor = (context) => {
  const p = context.payload;
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots : [];
  const mapped = {
    events: [],
    sessionId: printable(p.conversation_id, 128) ?? printable(p.session_id, 128),
    model: printable(p.model_id, 128) ?? printable(p.model, 128),
    runtimeVersion: clip(p.cursor_version, 64),
    cwd: text(roots[0]) ?? text(p.cwd) ?? context.env.cursorProjectDir
  };
  const toolName = p.tool_name ?? (Object.hasOwn(EVENT_TOOL, context.event) ? EVENT_TOOL[context.event] : void 0);
  const call = {
    runtime: context.runtime,
    name: toolName,
    input: toolInputOf(p),
    useId: p.tool_use_id,
    busServer: context.busServer
  };
  const withTool = (result) => result === null ? mapped : { ...mapped, events: [result.draft], tool: result.tool };
  const push = (draft) => {
    mapped.events.push(draft);
    return mapped;
  };
  switch (context.event) {
    case "sessionStart":
      return push({ type: "session.start", data: { trigger: "startup" } });
    case "sessionEnd":
      return push(
        sessionEnd(sessionStatus(p.final_status), p.reason, {
          duration_ms: count(p.duration_ms),
          error_code: clip(p.error_code, 64)
        })
      );
    case "beforeSubmitPrompt":
      return push(promptSubmit(p.prompt, context));
    case "postToolUse":
      return withTool(
        toolEvent("tool.post", call, context.detail, {
          duration_ms: count(p.duration) ?? count(p.duration_ms),
          output_bytes: p.tool_output === void 0 ? void 0 : byteLength(p.tool_output)
        })
      );
    case "postToolUseFailure": {
      const failure = text(p.failure_type);
      return withTool(
        toolEvent("tool.fail", call, context.detail, {
          duration_ms: count(p.duration) ?? count(p.duration_ms),
          error_kind: p.is_interrupt === true ? "interrupted" : FAILURE_KINDS.has(failure ?? "") ? failure : "error",
          error: freeText(p.error_message)
        })
      );
    }
    case "preToolUse":
    case "beforeShellExecution":
    case "beforeMCPExecution":
    case "beforeReadFile":
      return withTool(toolEvent("tool.pre", call, context.detail, {}));
    case "subagentStart":
    case "subagentStop": {
      const ids = subagentIds2(p);
      if (ids === null) return mapped;
      const agentType = clip(p.subagent_type, 128) ?? clip(p.agent_type, 128);
      mapped.subagent = { type: agentType };
      if (context.event === "subagentStart") {
        return push({ type: "subagent.start", data: compact({ ...ids, agent_type: agentType ?? "unknown" }) });
      }
      return push({
        type: "subagent.stop",
        data: compact({
          ...ids,
          agent_type: agentType,
          status: subagentStatus(p.status),
          duration_ms: count(p.duration_ms),
          tool_uses: count(p.tool_call_count)
        })
      });
    }
    case "stop":
      return push(turnEnd({ status: clip(p.status, 32) }));
    case "preCompact":
      return push({
        type: "compact",
        data: compact({
          phase: "pre",
          trigger: compactTrigger(p.trigger),
          tokens_before: count(p.context_tokens),
          context_window: count(p.context_window_size),
          context_used_percent: typeof p.context_usage_percent === "number" && p.context_usage_percent >= 0 && p.context_usage_percent <= 100 ? p.context_usage_percent : void 0
        })
      });
    default:
      return mapped;
  }
};

// src/mappers/index.ts
var MAPPERS = {
  "claude-code": mapClaudeCode,
  codex: mapCodex,
  cursor: mapCursor,
  agy: mapAgy
};
var COMPLEMENT_TYPES = {
  "claude-code": /* @__PURE__ */ new Set(["subagent.start", "subagent.stop", "handoff.pointer", "notification", "compact"]),
  codex: /* @__PURE__ */ new Set(["session.start", "subagent.start", "subagent.stop", "compact", "notification"]),
  cursor: /* @__PURE__ */ new Set(["session.start", "subagent.stop", "compact", "notification"]),
  agy: /* @__PURE__ */ new Set()
};
var COMPLEMENT_EXCLUDED_NOTIFICATIONS = {
  "claude-code": /* @__PURE__ */ new Set(["turn_end"]),
  codex: /* @__PURE__ */ new Set(),
  cursor: /* @__PURE__ */ new Set(),
  agy: /* @__PURE__ */ new Set()
};
function inScope(runtime, scope, draft) {
  if (scope === "all") return true;
  if (!COMPLEMENT_TYPES[runtime].has(draft.type)) return false;
  return draft.type !== "notification" || !COMPLEMENT_EXCLUDED_NOTIFICATIONS[runtime].has(String(draft.data.kind));
}
function mapHook(context, scope) {
  const mapped = MAPPERS[context.runtime](context);
  return { ...mapped, events: mapped.events.filter((draft) => inScope(context.runtime, scope, draft)) };
}

// src/probe.ts
import { isAbsolute as isAbsolute4 } from "node:path";
var MAX_KEYS = 200;
var SAFE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
function payloadKeys(payload) {
  const keys = /* @__PURE__ */ new Set();
  const name = (key) => SAFE_KEY.test(key) ? key : "?";
  for (const [key, value] of Object.entries(payload)) {
    if (keys.size >= MAX_KEYS) break;
    keys.add(name(key));
    if (!isRecord(value)) continue;
    for (const child of Object.keys(value)) {
      if (keys.size >= MAX_KEYS) break;
      keys.add(`${name(key)}.${name(child)}`);
    }
  }
  return [...keys].sort();
}
function writeProbe(path, record) {
  if (!isAbsolute4(path)) return false;
  const result = appendExclusive(path, () => `${JSON.stringify(record)}
`);
  return result !== null && result !== "refused";
}

// src/runtime.ts
function detectRuntime(flag, payload, cursorVersionEnv) {
  if (payload.cursor_version !== void 0 || cursorVersionEnv !== void 0) return "cursor";
  if (flag !== void 0) return flag;
  if ("conversationId" in payload || "toolCall" in payload || "stepIdx" in payload) return "agy";
  if ("turn_id" in payload) return "codex";
  return "claude-code";
}
var CURSOR_ALIASES = {
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  UserPromptSubmit: "beforeSubmitPrompt",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  PostToolUseFailure: "postToolUseFailure",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  Stop: "stop",
  PreCompact: "preCompact"
};
function eventNameOf(runtime, flag, payload) {
  const name = flag ?? text(payload.hook_event_name);
  if (name === void 0 || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) return void 0;
  if (runtime === "cursor") return Object.hasOwn(CURSOR_ALIASES, name) ? CURSOR_ALIASES[name] : name;
  return name;
}
var CURSOR_JSON_EVENTS = /* @__PURE__ */ new Set([
  "preToolUse",
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "subagentStart"
]);
function stdoutReply(runtime, event) {
  if (runtime === "agy") return "{}";
  if (runtime === "cursor" && event !== void 0 && CURSOR_JSON_EVENTS.has(event)) return "{}";
  return null;
}
function eventBudgetMs(runtime, event, configuredMs) {
  const short = runtime === "claude-code" && event === "SessionEnd" || runtime === "codex" && (event === "SessionEnd" || event === "Interrupt");
  return short ? Math.min(configuredMs, BUDGET.shortMs) : configuredMs;
}
function parsePayload(textValue) {
  try {
    const parsed = JSON.parse(textValue);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
var QUOTE = 34;
var BACKSLASH = 92;
var COMMA = 44;
var OPEN_OBJECT = 123;
var OPEN_ARRAY = 91;
function stringEnd(textValue, open) {
  let close = textValue.indexOf('"', open + 1);
  while (close !== -1) {
    let slashes = 0;
    while (textValue.charCodeAt(close - 1 - slashes) === BACKSLASH) slashes++;
    if (slashes % 2 === 0) return close + 1;
    close = textValue.indexOf('"', close + 1);
  }
  return textValue.length;
}
function exceedsStructure(textValue, maxNodes) {
  let nodes = 0;
  let index = 0;
  while (index < textValue.length) {
    const code = textValue.charCodeAt(index);
    if (code === QUOTE) {
      index = stringEnd(textValue, index);
      continue;
    }
    if (code === COMMA || code === OPEN_OBJECT || code === OPEN_ARRAY) {
      nodes++;
      if (nodes > maxNodes) return true;
    }
    index++;
  }
  return false;
}

// src/spool.ts
import { existsSync as existsSync2 } from "node:fs";
import { isAbsolute as isAbsolute5, join as join6, sep } from "node:path";
function absoluteEnv(value) {
  return value !== void 0 && value !== "" && isAbsolute5(value) ? value : void 0;
}
function localAppData(location) {
  return absoluteEnv(location.env.LOCALAPPDATA) ?? join6(location.home, "AppData", "Local");
}
function cacheDir(location) {
  if (location.platform === "win32") return join6(localAppData(location), "playbook-telemetry");
  return join6(absoluteEnv(location.env.XDG_CACHE_HOME) ?? join6(location.home, ".cache"), "playbook-telemetry");
}
function cacheTarget(location) {
  const dir = cacheDir(location);
  return { kind: "cache", path: join6(dir, `spool-${location.rootHash.slice(0, 16)}.jsonl`), createDir: dir };
}
var CASE_INSENSITIVE_PLATFORMS = /* @__PURE__ */ new Set(["win32", "darwin"]);
function comparablePath(path, platform) {
  return CASE_INSENSITIVE_PLATFORMS.has(platform) ? path.normalize("NFC").toUpperCase().toLowerCase() : path;
}
function isWithin(dir, root, platform) {
  const comparableDir = comparablePath(dir, platform);
  const comparableRoot = comparablePath(root, platform);
  const rootPrefix = comparableRoot.endsWith(sep) ? comparableRoot : `${comparableRoot}${sep}`;
  return comparableDir === comparableRoot || comparableDir.startsWith(rootPrefix);
}
function externalSpoolDir(dir, root, platform) {
  const realDir = resolveRealDir(dir);
  const realRoot2 = resolveRealDir(root);
  if (realDir === null || realRoot2 === null) return null;
  return isWithin(realDir, realRoot2, platform) ? null : realDir;
}
function containmentHolds(target, opened) {
  const containment = target.containment;
  if (containment === void 0) return true;
  if (externalSpoolDir(containment.dir, containment.root, containment.platform) !== target.createDir) return false;
  if (opened === void 0) return true;
  const named = fileIdentity(target.path);
  return named !== null && named.dev === opened.dev && named.ino === opened.ino;
}
function spoolTargets(location) {
  const runSpool = location.runSpool;
  if (runSpool.kind === "run") {
    const dir = externalSpoolDir(runSpool.dir, location.root, location.platform);
    if (dir === null) return [cacheTarget(location)];
    const containment = { dir: runSpool.dir, root: location.root, platform: location.platform };
    return [
      { kind: "run", path: join6(dir, `${runSpool.runId}.jsonl`), createDir: dir, containment },
      cacheTarget(location)
    ];
  }
  if (runSpool.kind === "invalid") return [cacheTarget(location)];
  const targets = [];
  if (location.taskId !== void 0) {
    const taskDir = join6(location.root, "tasks", location.taskId);
    if (isRealDirectory(taskDir)) {
      targets.push({ kind: "task", path: join6(taskDir, "telemetry.jsonl"), createDir: void 0 });
    }
  }
  const claudeDir = join6(location.root, ".claude");
  if (isDirectory(claudeDir)) {
    targets.push({ kind: "project", path: join6(claudeDir, "telemetry-spool.jsonl"), createDir: void 0 });
  }
  targets.push(cacheTarget(location));
  return targets;
}
function serializeEvents(events) {
  return events.map((event) => `${JSON.stringify(event)}
`).join("");
}
function fullMarker(writer, path) {
  return writer.stateDir === null ? null : join6(writer.stateDir, `${writer.sha256Hex(path).slice(0, 16)}.spool_full`);
}
function limitedContent(events, size, marker2, writer) {
  if (size >= SPOOL.hardLimitBytes) {
    if (marker2 === null || createExclusive(marker2, String(size)) !== true) return { text: "", written: 0 };
    const full = writer.spoolFullEvent();
    return full === null ? { text: "", written: 0 } : { text: serializeEvents([full]), written: 0 };
  }
  if (marker2 !== null && existsSync2(marker2)) removeQuietly(marker2);
  const kept = size >= SPOOL.softLimitBytes ? events.filter((event) => !SPOOL.softDropTypes.includes(event.type)) : events;
  return { text: serializeEvents(kept), written: kept.length };
}
function appendToSpool(targets, events, writer) {
  if (events.length === 0) return null;
  for (const target of targets) {
    if (!containmentHolds(target)) continue;
    if (target.createDir !== void 0 && !ensureDir(target.createDir)) continue;
    const marker2 = fullMarker(writer, target.path);
    let written = 0;
    const result = appendExclusive(target.path, (size, opened) => {
      if (!containmentHolds(target, opened)) return null;
      const content = limitedContent(events, size, marker2, writer);
      written = content.written;
      return content.text;
    });
    if (result !== null && result !== "refused") return { target, written, dropped: events.length - written };
  }
  return null;
}

// src/stdin.ts
function readStdin(stream, options) {
  if (stream.isTTY === true) return Promise.resolve({ kind: "empty" });
  return new Promise((resolve2) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    let settled = false;
    let idleTimer;
    let capTimer;
    let generation = 0;
    const onTimeout = () => {
      if (oversized) settle({ kind: "oversized", bytes: size });
      else if (size === 0) settle({ kind: "timeout" });
      else settle({ kind: "partial", text: Buffer.concat(chunks).toString("utf8") });
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      generation++;
      const armedAt = generation;
      idleTimer = setTimeout(
        () => setImmediate(() => {
          if (armedAt === generation) onTimeout();
        }),
        Math.max(0, options.idleMs)
      );
    };
    const onData = (chunk) => {
      if (settled) return;
      armIdle();
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += buffer.length;
      if (oversized) return;
      if (size > options.maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (oversized) settle({ kind: "oversized", bytes: size });
      else if (size === 0) settle({ kind: "empty" });
      else settle({ kind: "data", text: Buffer.concat(chunks).toString("utf8") });
    };
    const onError = () => settle({ kind: "error", bytes: size });
    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(capTimer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("close", onEnd);
      stream.off("error", onError);
      stream.pause();
      resolve2(result);
    }
    armIdle();
    capTimer = setTimeout(() => setImmediate(onTimeout), Math.max(0, options.maxWaitMs));
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("close", onEnd);
    stream.on("error", onError);
  });
}

// src/emitter.ts
function lateStopAtMs(budgetMs) {
  return Math.min(2 * budgetMs - BUDGET.watchdogMarginMs, BUDGET.lateHardStopMs);
}
function isLocalFailure(outcome, timeoutMs) {
  if (outcome.kind !== "retry") return false;
  return outcome.local === true || outcome.reason === "timeout" && timeoutMs < BUDGET.breakerMinTimeoutMs;
}
var EmitterRun = class {
  /** Resposta no stdout (`{}` no agy e nos eventos de permissão do Cursor), ou `null`. */
  reply = null;
  /** Prazo atual (ms desde o início do processo); `onBudget` é avisado a cada mudança. */
  budgetMs = BUDGET.defaultMs;
  onBudget;
  pending = null;
  settled = false;
  /** O prazo venceu antes de o evento existir: termina só com trabalho local (spool), sem rede. */
  expired = false;
  /** Lock da drenagem em curso e o destino dele (a remoção no prazo confere a contenção do spool externo). */
  activeLock = null;
  debug = { log: () => void 0 };
  /** Configuração lida no início de `run()`; o caminho tardio precisa dela sem o payload. */
  config;
  /** `undefined` enquanto não resolvido; depois o diretório privado ou `null` (sem estado). */
  resolvedStateDir;
  /** A linha `deadline_before_payload` desta invocação já foi gravada (ou decidida): no máximo uma. */
  deadlineRecorded = false;
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  /**
   * Chamado pelo watchdog e pelos handlers de erro antes de sair: grava no spool o evento ainda não confirmado e
   * libera o lock de drenagem, se houver. Síncrono.
   */
  flushPending(reason) {
    if (this.activeLock !== null) {
      if (containmentHolds(this.activeLock.target)) removeQuietly(this.activeLock.path);
      this.activeLock = null;
    }
    if (this.pending === null) {
      if (reason === "late") this.recordDeadline("late_stop");
      return;
    }
    if (this.settled) return;
    this.settled = true;
    const written = appendToSpool(this.pending.targets, this.pending.events, this.pending.writer);
    this.debug.log("flush", { reason, spool: written?.target.kind ?? "none" });
  }
  /**
   * Chamado pelo watchdog em P − 50 ms. Com o evento pronto: grava o pendente no spool e pede a saída (`'exit'`).
   * Antes disso (o processo só ganhou CPU depois do prazo): marca o prazo como vencido e deixa o pipeline terminar
   * sem rede — o payload já entregue vai ao spool em vez de se perder (`'finish_local'`).
   */
  expire() {
    this.expired = true;
    if (this.pending === null) return "finish_local";
    this.flushPending("watchdog");
    return "exit";
  }
  async run() {
    const config = readConfig(this.deps.argv, this.deps.env);
    this.config = config;
    this.setBudget(config.budgetMs);
    if (config.debug) this.debug = createDebugLog(this.stateDir(), () => this.deps.wallMs(), this.deps.pid);
    if (config.runtimeFlag === "agy") this.reply = stdoutReply("agy", void 0);
    const cursorPossible = config.runtimeFlag === "cursor" || config.cursorVersion !== void 0;
    if (config.collector.kind === "noop" && config.probeLog === void 0 && !cursorPossible) {
      return { status: "noop" };
    }
    const input = await readStdin(this.deps.stdin, {
      idleMs: BUDGET.stdinTimeoutMs,
      maxWaitMs: lateStopAtMs(this.budgetMs) - this.deps.elapsedMs(),
      maxBytes: PAYLOAD.stdinMaxBytes
    });
    if (input.kind !== "data" && input.kind !== "partial") return this.noPayload(input, input.kind);
    if (exceedsStructure(input.text, PAYLOAD.stdinMaxNodes)) return this.tooComplex(config, input.text.length);
    const payload = parsePayload(input.text);
    if (payload === null) return this.noPayload(input, input.kind === "partial" ? "timeout" : "invalid_json");
    const runtime = detectRuntime(config.runtimeFlag, payload, config.cursorVersion);
    const event = eventNameOf(runtime, config.eventFlag, payload);
    this.reply = stdoutReply(runtime, event);
    if (config.probeLog !== void 0) {
      writeProbe(config.probeLog, {
        ts: new Date(this.deps.wallMs()).toISOString(),
        runtime,
        event: event ?? null,
        keys: payloadKeys(payload)
      });
    }
    if (config.collector.kind === "noop") return { status: "noop" };
    if (event === void 0) return { status: "unmapped", reason: "no_event_name" };
    this.setBudget(eventBudgetMs(runtime, event, config.budgetMs));
    const stateDir = this.stateDir();
    const result = await this.emit(config, runtime, event, payload, stateDir);
    this.debug.log("done", { runtime, event, status: result.status, reason: result.reason, spool: result.spool });
    return result;
  }
  /**
   * Payload acima do teto estrutural (`PAYLOAD.stdinMaxNodes`): não passa pelo `JSON.parse`, cujo custo síncrono
   * cresce com o número de valores e passaria da parada interna. Sem o payload não há sessão, `cwd` nem nome
   * de evento do runtime: o runtime e o evento vêm das flags, e a raiz do projeto, do diretório do processo. Em vez de
   * sumir em silêncio, vira `error{scope:'hook', code:'payload_too_complex'}`, entregue como qualquer evento (POST ou
   * spool) e fora do filtro de escopo, como o `spool_full`: é a saúde do próprio emissor. O log de depuração registra.
   */
  async tooComplex(config, chars) {
    const runtime = detectRuntime(config.runtimeFlag, {}, config.cursorVersion);
    const event = eventNameOf(runtime, config.eventFlag, {});
    this.reply = stdoutReply(runtime, event);
    this.debug.log("too_complex", { runtime, event, chars });
    if (config.collector.kind === "noop") return { status: "no_payload", reason: "too_complex" };
    if (event !== void 0) this.setBudget(eventBudgetMs(runtime, event, config.budgetMs));
    const stateDir = this.stateDir();
    const result = await this.emitMapped(
      config,
      runtime,
      { events: [hookError("payload_too_complex", event)] },
      stateDir
    );
    this.debug.log("done", { runtime, event, status: result.status, reason: result.reason, spool: result.spool });
    return result;
  }
  async emit(config, runtime, event, payload, stateDir) {
    const deps = this.deps;
    const sha256Hex = (text2) => toHex(deps.sha256(text2));
    const tsMs = Math.floor(deps.startWallMs);
    const mapped = mapHook(
      {
        runtime,
        event,
        payload,
        detail: config.detail,
        tsMs,
        sha256Hex,
        readTail: (path, maxBytes) => readTail(path, maxBytes),
        env: { claudeProjectDir: config.claudeProjectDir, cursorProjectDir: config.cursorProjectDir },
        platform: deps.platform,
        busServer: config.busServer
      },
      config.scope
    );
    if (mapped.events.length === 0) return { status: "unmapped", reason: config.scope };
    return this.emitMapped(config, runtime, mapped, stateDir);
  }
  /** Passos 5 a 10: projeto, task, envelope, entrega (POST ou spool) e drenagem. */
  async emitMapped(config, runtime, mapped, stateDir) {
    const { events, sha256Hex } = this.prepare(config, runtime, mapped, stateDir);
    const runScoped = config.runId !== void 0 || config.runSpool.kind !== "none";
    return this.deliver(config.collector, config.token, events, stateDir, sha256Hex, runScoped);
  }
  /**
   * Passos 5 a 7, síncronos: projeto, task, envelope e destinos de spool. Deixa o evento pendente (o watchdog e o
   * caminho tardio gravam o pendente no spool sem esperar a rede).
   */
  prepare(config, runtime, mapped, stateDir) {
    const deps = this.deps;
    const sha256Hex = (text2) => toHex(deps.sha256(text2));
    const tsMs = Math.floor(deps.startWallMs);
    const cwd = mapped.cwd ?? deps.cwd;
    const project = resolveProject(cwd, deps.sha256);
    const task = detectTask({
      project,
      cwd,
      envTaskId: config.taskIdEnv,
      tool: mapped.tool,
      runtime,
      sessionId: mapped.sessionId,
      stateDir,
      uid: deps.uid,
      nowMs: deps.wallMs(),
      sha256: deps.sha256,
      uniqueSuffix: `${deps.pid}-${tsMs}`
    });
    const envelope2 = {
      runtime,
      runtimeVersion: mapped.runtimeVersion,
      project: { id: config.projectId, root_hash: project.rootHash, remote: project.remote },
      taskId: task?.taskId,
      taskSource: task?.source,
      sessionId: mapped.sessionId,
      runId: config.runId,
      agent: agentOf({ role: config.agentRole, subagent: mapped.subagent }),
      model: mapped.model
    };
    const sanitize = {
      paths: { root: project.root, home: deps.homeDir, tmpDirs: [deps.tmpDir], cwd },
      detail: config.detail
    };
    const ulid = createUlidFactory({ random: (size) => deps.randomBytes(size) });
    const ts = new Date(tsMs).toISOString();
    const build = (drafts) => buildEvents(drafts, envelope2, sanitize, () => ulid.next(tsMs), ts);
    const events = build(mapped.events);
    const targets = spoolTargets({
      root: project.root,
      rootHash: project.rootHash,
      taskId: task?.taskId,
      runSpool: config.runSpool,
      home: deps.homeDir,
      platform: deps.platform,
      env: deps.env
    });
    const writer = {
      stateDir,
      sha256Hex,
      spoolFullEvent: () => build([{ type: "error", data: { scope: "hook", code: "spool_full", fatal: false } }])[0] ?? null
    };
    this.pending = { events, targets, writer };
    return { events, sha256Hex };
  }
  /**
   * Fim sem payload utilizável (vazio, acima de 8 MiB, JSON inválido, pipe sem EOF, erro de leitura): não há evento.
   * O log de depuração registra o motivo e o tamanho lido, nunca o conteúdo. Se o prazo já tinha vencido e o payload
   * não chegou inteiro, a perda foi do prazo: fica a linha `deadline_before_payload`.
   */
  noPayload(input, reason) {
    this.debug.log("no_payload", { reason, size: stdinSize(input) });
    if (this.expired && (input.kind === "timeout" || input.kind === "partial")) this.recordDeadline(reason);
    return { status: "no_payload", reason };
  }
  /**
   * O prazo venceu antes de o evento existir (máquina sem CPU: o processo ganhou a CPU tarde, e o payload ainda não
   * tinha sido lido ou mapeado quando chegou a parada tardia). Síncrono e sem rede, como o `tooComplex`: runtime e
   * evento das flags, raiz pelo `cwd` do processo, nenhum conteúdo do payload. Vai só ao spool, fora do filtro de
   * escopo (saúde do emissor); no modo no-op (sem URL do coletor) nada é gravado, só o log de depuração.
   */
  recordDeadline(reason) {
    const config = this.config;
    if (config === void 0 || this.deadlineRecorded || this.settled) return;
    this.deadlineRecorded = true;
    const runtime = detectRuntime(config.runtimeFlag, {}, config.cursorVersion);
    const event = eventNameOf(runtime, config.eventFlag, {});
    this.debug.log("late", { reason, elapsedMs: Math.round(this.deps.elapsedMs()), runtime, event });
    if (config.collector.kind === "noop") return;
    try {
      this.prepare(config, runtime, { events: [hookError("deadline_before_payload", event)] }, this.stateDir());
      this.settled = true;
      const written = appendToSpool(this.pendingTargets(), this.pending?.events ?? [], this.pendingWriter());
      this.debug.log("flush", { reason: "deadline_before_payload", spool: written?.target.kind ?? "none" });
    } catch {
    }
  }
  async deliver(collector, token, events, stateDir, sha256Hex, runScoped) {
    if (collector.kind !== "http") return this.spool(events, collector.kind === "spool" ? collector.reason : "noop");
    const timeoutMs = Math.min(BUDGET.postMaxMs, this.remainingMs() - BUDGET.networkMarginMs);
    if (this.expired || timeoutMs < BUDGET.minPostMs) return this.spool(events, "no_time");
    const breakerFile = stateDir === null ? null : breakerPath(stateDir, collector.url.href, sha256Hex);
    const breaker = breakerFile === null ? CLOSED_BREAKER : readBreaker(breakerFile);
    if (isBreakerOpen(breaker, this.deps.wallMs())) return this.spool(events, "breaker_open");
    const outcome = await this.deps.post(collector.url, JSON.stringify(events), {
      token,
      timeoutMs,
      replay: false,
      nowMs: this.deps.wallMs()
    });
    this.updateBreaker(breakerFile, breaker, outcome, timeoutMs);
    switch (outcome.kind) {
      case "accepted": {
        this.settled = true;
        const retry = new Set(outcome.rejected.filter((r) => r.retryable).map((r) => r.index));
        const retried = events.filter((_, index) => retry.has(index));
        const result = { status: "sent", events: events.length };
        if (retried.length > 0) {
          const written = appendToSpool(this.pendingTargets(), retried, this.pendingWriter());
          result.spool = written?.target.kind;
        }
        const drained = await this.drain(collector.url, token, breakerFile, runScoped);
        return drained === void 0 ? result : { ...result, drained };
      }
      case "discard":
        this.settled = true;
        this.debug.log("discard", { status: outcome.status });
        return { status: "dropped", reason: `http_${outcome.status}` };
      case "retry":
        return this.spool(events, outcome.reason);
      default:
        return this.spool(events, `http_${outcome.status}`);
    }
  }
  pendingTargets() {
    return this.pending?.targets ?? [];
  }
  pendingWriter() {
    return this.pending?.writer ?? { stateDir: null, sha256Hex: () => "", spoolFullEvent: () => null };
  }
  spool(events, reason) {
    this.settled = true;
    const written = appendToSpool(this.pendingTargets(), events, this.pendingWriter());
    if (written === null) return { status: "lost", reason };
    return { status: "spooled", reason, events: written.written, spool: written.target.kind };
  }
  updateBreaker(file, state, outcome, timeoutMs) {
    if (file === null) return;
    const suffix = `${this.deps.pid}-${this.deps.wallMs()}`;
    if (outcome.kind === "retry" && !isLocalFailure(outcome, timeoutMs)) {
      writeBreaker(file, breakerAfterFailure(state, this.deps.wallMs(), outcome.retryAfterMs), suffix);
    } else if (outcome.kind === "accepted" && (state.failures > 0 || state.open_until_ms > 0)) {
      writeBreaker(file, CLOSED_BREAKER, suffix);
    }
  }
  /**
   * Um lote do primeiro spool com pendência, se sobrar tempo (último passo da invocação). Numa execução orquestrada o
   * token pode ser da execução, e o coletor, amarrar o lote a ela: só o spool da própria execução é drenado (linhas de
   * outro contexto seriam recusadas e perdidas). Fora dela, o spool externo nunca aparece nos destinos.
   */
  async drain(url, token, breakerFile, runScoped) {
    if (this.expired || this.remainingMs() < BUDGET.drainMinRemainingMs) return void 0;
    const target = this.pendingTargets().find(
      (candidate) => (!runScoped || candidate.kind === "run") && hasPending(candidate.path)
    );
    if (target === void 0) return void 0;
    const deps = this.deps;
    const ulid = createUlidFactory({ random: (size) => deps.randomBytes(size) });
    let outcome;
    let timeoutMs = 0;
    const result = await drainOnce(target.path, {
      now: () => deps.wallMs(),
      ulid: () => ulid.next(deps.wallMs()),
      pid: deps.pid,
      host: deps.hostName,
      onLock: (lockPath) => {
        this.activeLock = lockPath === null ? null : { path: lockPath, target };
      },
      contained: (opened) => containmentHolds(target, opened),
      post: async (body) => {
        timeoutMs = this.remainingMs() - BUDGET.networkMarginMs;
        outcome = timeoutMs < BUDGET.minPostMs ? { kind: "retry", reason: "no_time", local: true } : await deps.post(url, body, { token, timeoutMs, replay: true, nowMs: deps.wallMs() });
        return outcome;
      }
    });
    if (outcome !== void 0 && breakerFile !== null) {
      this.updateBreaker(breakerFile, readBreaker(breakerFile), outcome, timeoutMs);
    }
    this.debug.log("drain", { spool: target.kind, status: result.status });
    return `${target.kind}:${result.status}`;
  }
  remainingMs() {
    return this.budgetMs - this.deps.elapsedMs();
  }
  setBudget(budgetMs) {
    this.budgetMs = budgetMs;
    this.onBudget?.(budgetMs);
  }
  /**
   * `${XDG_RUNTIME_DIR}/playbook-telemetry` ou `${tmpdir}/playbook-telemetry-<uid>`, só se for privado do usuário;
   * senão sem estado (disjuntor, pegajoso, debug). Resolvido uma vez por invocação.
   */
  stateDir() {
    if (this.resolvedStateDir === void 0) {
      this.resolvedStateDir = resolveStateDir({
        runtimeDir: this.deps.env.XDG_RUNTIME_DIR,
        tmpDir: this.deps.tmpDir,
        uid: this.deps.uid,
        name: STATE_DIR_NAME
      });
    }
    return this.resolvedStateDir;
  }
};
function hookError(code, event) {
  return { type: "error", data: compact({ scope: "hook", code, fatal: false, hook_event: clip(event, 48) }) };
}
function stdinSize(input) {
  switch (input.kind) {
    case "data":
    case "partial":
      return input.text.length;
    case "oversized":
    case "error":
      return input.bytes;
    default:
      return 0;
  }
}

// src/transport.ts
function parseRetryAfter(value, nowMs) {
  if (value === void 0) return void 0;
  const trimmed = value.trim();
  if (/^\d{1,9}$/.test(trimmed)) return Number(trimmed) * 1e3;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? void 0 : Math.max(0, date - nowMs);
}
function parseRejections(body) {
  try {
    const parsed = JSON.parse(body);
    if (!isRecord(parsed) || !Array.isArray(parsed.rejected)) return [];
    const out = [];
    for (const item of parsed.rejected) {
      if (!isRecord(item)) continue;
      const index = count(item.index);
      if (index === void 0) continue;
      out.push({ index, retryable: item.retryable === true, code: text(item.code) ?? "unknown" });
    }
    return out;
  } catch {
    return [];
  }
}
function classifyResponse(status, body, retryAfter, nowMs) {
  if (status >= 200 && status < 300) return { kind: "accepted", status, rejected: parseRejections(body) };
  if (status === 408 || status === 429 || status >= 500) {
    const retryAfterMs = parseRetryAfter(retryAfter, nowMs);
    return retryAfterMs === void 0 ? { kind: "retry", reason: `http_${status}`, status } : { kind: "retry", reason: `http_${status}`, status, retryAfterMs };
  }
  if (status === 413) return { kind: "too_large", status };
  if (status === 400 || status === 415) return { kind: "discard", status };
  return { kind: "keep", status };
}
function readBody(response) {
  return new Promise((resolve2) => {
    const chunks = [];
    let size = 0;
    response.on("data", (chunk) => {
      if (size >= PAYLOAD.responseMaxBytes) return;
      size += chunk.length;
      chunks.push(chunk);
    });
    response.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8").slice(0, PAYLOAD.responseMaxBytes)));
    response.on("error", () => resolve2(""));
    response.on("aborted", () => resolve2(""));
  });
}
function loadSend(protocol) {
  return protocol === "https:" ? import("node:https").then((https) => https.request) : import("node:http").then((http) => http.request);
}
function requestHeaders(payload, options) {
  const headers = {
    "content-type": "application/json",
    "content-length": String(payload.length),
    "user-agent": `playbook-telemetry-emit/${EMITTER_VERSION}`
  };
  if (options.token !== void 0) headers.authorization = `Bearer ${options.token}`;
  if (options.replay) headers["x-playbook-replay"] = "1";
  return headers;
}
var postEvents = (url, body, options) => new Promise((resolve2) => {
  if (options.timeoutMs <= 0) {
    resolve2({ kind: "retry", reason: "no_time", local: true });
    return;
  }
  let settled = false;
  let req;
  const timer = setTimeout(() => {
    settle({ kind: "retry", reason: "timeout" });
    req?.destroy();
  }, options.timeoutMs);
  function settle(outcome) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve2(outcome);
  }
  const dispatch = (send) => {
    if (settled) return;
    const payload = Buffer.from(body, "utf8");
    try {
      req = send(url, { method: "POST", headers: requestHeaders(payload, options), agent: false });
    } catch {
      settle({ kind: "retry", reason: "request_error", local: true });
      return;
    }
    req.on("response", (response) => {
      readBody(response).then((text2) => {
        const retryAfter = response.headers["retry-after"];
        settle(classifyResponse(response.statusCode ?? 0, text2, retryAfter, options.nowMs));
      });
    });
    req.on("error", (error) => settle({ kind: "retry", reason: error.code ?? "network" }));
    req.end(payload);
  };
  loadSend(url.protocol).then(dispatch, () => settle({ kind: "retry", reason: "request_error", local: true }));
});

// src/emit.ts
process.exitCode = 0;
process.noDeprecation = true;
process.removeAllListeners("warning");
var finished = false;
var emitter;
var watchdog;
function finish(reason) {
  if (finished) return;
  finished = true;
  try {
    emitter?.flushPending(reason);
  } catch {
  }
  try {
    const reply = emitter?.reply;
    if (reply !== null && reply !== void 0) writeSync2(1, reply);
  } catch {
  }
  process.exit(0);
}
process.on("uncaughtException", () => finish("uncaught"));
process.on("unhandledRejection", () => finish("unhandled"));
function safeHome() {
  try {
    return homedir();
  } catch {
    return process.env.HOME ?? process.env.USERPROFILE ?? tmpdir();
  }
}
try {
  emitter = new EmitterRun({
    argv: process.argv.slice(2),
    env: process.env,
    stdin: process.stdin,
    elapsedMs: () => performance.now(),
    wallMs: () => Date.now(),
    startWallMs: performance.timeOrigin,
    homeDir: safeHome(),
    tmpDir: tmpdir(),
    cwd: process.cwd(),
    hostName: hostname(),
    pid: process.pid,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    platform: process.platform,
    randomBytes: (size) => randomBytes(size),
    sha256: (text2) => createHash("sha256").update(text2, "utf8").digest(),
    post: postEvents
  });
  const onDeadline = () => {
    if (emitter === void 0 || emitter.expire() === "exit") {
      finish("watchdog");
      return;
    }
    setTimeout(() => finish("late"), Math.max(0, lateStopAtMs(emitter.budgetMs) - performance.now())).unref();
  };
  emitter.onBudget = (budgetMs) => {
    if (watchdog !== void 0) clearTimeout(watchdog);
    watchdog = setTimeout(onDeadline, Math.max(0, budgetMs - BUDGET.watchdogMarginMs - performance.now()));
    watchdog.unref();
  };
  emitter.run().then(
    () => finish("done"),
    () => finish("error")
  );
} catch {
  finish("error");
}
