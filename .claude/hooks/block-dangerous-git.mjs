#!/usr/bin/env node
// PreToolUse/Bash — bloqueia comandos git/shell destrutivos, inclusive sintaxes
// que burlam o deny por prefixo (ex.: git push -u origin main, git push origin branch:main).
// Multiplataforma (macOS/Linux/Windows).
// exit 2 = bloqueia a ação e devolve o stderr ao agente.

import { readFileSync } from "node:fs";

let cmd = "";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  cmd = input?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

// ---------- heredoc ----------
// O corpo de um heredoc é DADO para quem o consome — a menos que algo no comando o
// execute, caso em que o corpo é código. Corpo de dado sai da análise: senão uma
// mensagem de commit (`git commit -F - <<EOF`) ou um documento gravado por
// `cat > x.md <<EOF` que *fale* de "push em main" dispara a trava.
// "Algo no comando o executa" olha o comando INTEIRO fora dos corpos, não só a linha
// do `<<`: `cat <<EOF | bash` entrega o corpo pelo pipe, e `cat > s.sh <<EOF … ; sh s.sh`
// grava um script e o roda depois. Conta como executor: interpretador, `eval`/`xargs`/
// `source`, caminho `./…` e arquivo com extensão de script. Aí nada é removido e o modo
// conservador liga (casa em qualquer posição), como nos wrappers.
// Na dúvida, o corpo fica. Delimitador sem fechamento → nada é removido.
// CLI de banco também executa o stdin: `psql <<EOF … DROP TABLE …` é a forma canônica de
// rodar DDL multi-statement, e a trava de DDL abaixo precisa ver o corpo.
const EXECUTOR = /^(?:(?:ba|z|k|da|fi)?sh|python[\d.]*|node|deno|bun|perl|ruby|php|pwsh|powershell|ssh|eval|xargs|source|\.|psql|mysql|mariadb|mongosh|mongo|sqlite3|sqlplus|sqlcmd|clickhouse-client|redis-cli)$/;
// Script local rodado por caminho (`./s`). Extensão não conta: gravar `x.mjs` não é
// executá-lo, e quem o roda aparece como interpretador (`node x.mjs`, `sh s.sh`).
const SCRIPT = /^\.\//;
// `<` e `>` também separam palavra: `bash<<'EOF'` sem espaço é shell válido.
const executa = (texto) => {
  const limpo = texto.replace(/['"]/g, "");
  const palavras = limpo.split(/[\s;&|(){}`<>]+/).filter((w) => w !== "");
  if (palavras.some((w) => EXECUTOR.test(w.replace(/^.*\//, "")) || SCRIPT.test(w))) return true;
  // Caminho em posição de comando é execução por caminho (`/tmp/s`, `$PWD/s`, `exec ~/s`,
  // `sudo -u x /tmp/s`, `timeout 5 /tmp/s`), seja qual for o comando que gravou o arquivo
  // (`>`, `tee`, `dd of=`, `install`…). Depois do wrapper, qualquer argumento sem `/` é dele.
  // Só a posição de comando conta: `git add docs/x.md` depois de gravar o doc não é execução.
  return /(?:^|[\n;&|(])\s*(?:(?:exec|env|nohup|sudo|doas|time|timeout|nice|ionice|command)\s+(?:[^\s\/;&|()<>]+\s+)*)*[^\s;&|()<>=]*\/[^\s;&|()<>]*/.test(limpo);
};
let execHeredoc = false;
const stripHeredocs = (text) => {
  const lines = String(text).split(/\r?\n/);
  const corpo = new Array(lines.length).fill(false);
  let achou = false;
  for (let i = 0; i < lines.length; i++) {
    if (corpo[i]) continue;
    // vários heredocs na mesma linha: os corpos vêm um depois do outro
    let cursor = i + 1;
    for (const m of lines[i].matchAll(/<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/g)) {
      const tabs = m[1] === "-";
      let end = -1;
      for (let j = cursor; j < lines.length; j++) {
        if ((tabs ? lines[j].replace(/^\t+/, "") : lines[j]) === m[3]) { end = j; break; }
      }
      if (end === -1) return String(text);
      for (let j = cursor; j < end; j++) corpo[j] = true;   // o delimitador fica
      cursor = end + 1;
      achou = true;
    }
  }
  if (!achou) return String(text);
  const fora = lines.filter((_, i) => !corpo[i]).join("\n");
  if (executa(fora)) { execHeredoc = true; return String(text); }
  return fora;
};
const body = stripHeredocs(cmd);

// ---------- quebra de linha ----------
// Fora de aspas, quebra de linha é separador de comando: `echo a\ngit clean -f` tem
// o comando perigoso em posição de comando. DENTRO de aspas é só texto — a mensagem
// multi-linha de `git commit -m "..."` não executa nada. Aspas desbalanceadas → toda
// quebra vira separador (comportamento anterior, conservador).
const splitLines = (s) => {
  let out = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === null && c === "\\" && i + 1 < s.length) { out += c + s[++i]; continue; }
    if (q === '"' && c === "\\" && i + 1 < s.length) { out += c + s[++i]; continue; }
    if (q === null && (c === "'" || c === '"')) q = c;
    else if (q === c) q = null;
    if (c === "\n" || c === "\r") out += q === null ? " ; " : " ";
    else out += c;
  }
  return q === null ? out : s.replace(/[\r\n]+/g, " ; ");
};
const norm = splitLines(body).replace(/\s+/g, " ");

// Remove só os CARACTERES de aspas, preservando o conteúdo, para que ofuscação
// por citação (`git clean -"f"`) continue casando. O texto citado deixa de ser
// perigoso pelo ancoramento em posição de comando (abaixo), não por ser apagado.
// `.claude/./hooks` e `.claude//hooks` são o mesmo caminho: normaliza antes de casar.
const flat = norm.replace(/['"]/g, "").replace(/\/(?:\.\/)+/g, "/").replace(/\/{2,}/g, "/");

// Um comando perigoso só conta quando está em POSIÇÃO DE COMANDO: início da
// entrada ou logo após um separador de shell, admitindo prefixo de variável de
// ambiente (FOO=1 rm -rf ...). É isto que impede o falso positivo de
// `grep "git clean -f" arquivo.md`, onde o padrão é argumento de busca, não comando.
const SEP = "[;&|(){}`]|\\$\\(";
const CMD = `(?:^|${SEP})\\s*(?:\\w+=\\S* +)*`;
// Um token de argumento nunca atravessa separador: sem isto, o `main` de
// `git push origin feat/x ; gh pr create --base main` era lido como alvo do push.
const TOK = "[^ ;&|(){}`]+";
// Opções globais do git antes do subcomando (git -C dir push, git -c k=v push).
// Só opção: texto livre entre `git` e `push` não conta — `git commit -m "... push ... main"` não é push.
const GITOPTS = "(?: +(?:-[Cc] +" + TOK + "|--(?:git-dir|work-tree|namespace) +" + TOK + "|-" + TOK + "))*";

// Wrappers que executam string como código: aí o conteúdo citado É comando, e o
// ancoramento não vale — voltamos a casar em qualquer posição (mais conservador).
// Herestring para interpretador (`bash <<< "rm -rf x"`) é o mesmo caso: a string é código.
const HERESTRING = /(?:^|[\s\/;&|(){}`])(?:(?:ba|z|k|da|fi)?sh|python[\d.]*|node|deno|bun|perl|ruby|php|pwsh|ssh)\b[^;&|]*<<</.test(flat);
const WRAPPER = execHeredoc || HERESTRING || new RegExp(`(?:^|${SEP})\\s*(?:\\w+=\\S* +)*(?:eval|xargs|(?:ba|z|k|da)?sh +-c|command +-[pv]* *\\w*sh)\\b`).test(flat);

const hit = (re) => {
  if (WRAPPER) return new RegExp(re).test(flat);
  return new RegExp(CMD + re).test(flat);
};

const block = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(2);
};

// push para main/master, em qualquer forma: aceita N flags/tokens entre `push` e o
// refspec (-u, --no-verify, etc.) e qualquer origem no refspec (branch:main, HEAD:main,
// refs completas). Guarda de fim de palavra evita falso positivo em main-backup etc.
if (hit("git" + GITOPTS + " +push( +" + TOK + ")* +([^ :;&|(){}`]+:)?(refs\\/heads\\/)?(main|master)([^-a-zA-Z0-9_/]|$)")) {
  block("BLOQUEADO: push direto em main/master. Fluxo correto: branch + draft PR (GOVERNANCE.md §2).");
}

// force push em qualquer ordem de flags, incluindo refspec com +
if (hit("git" + GITOPTS + " +push( +" + TOK + ")* +(--force|--force-with-lease|-f)([^-a-zA-Z]|$)")) {
  block("BLOQUEADO: force push. Se for realmente necessário, é decisão do Tech Lead, não do agente.");
}
if (hit("git" + GITOPTS + " +push( +" + TOK + ")* +\\+[^ ;&|(){}`]+")) {
  block("BLOQUEADO: push com refspec forçado (+). Equivale a force push (GOVERNANCE.md §2).");
}

// rm -rf / -fr em qualquer combinação de flags (e o equivalente Windows)
if (hit("rm +(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]* ")) {
  block("BLOQUEADO: rm -rf. Delete arquivos individualmente e explique o motivo no artifact.");
}
if (WRAPPER
  ? /(rmdir +\/s|rd +\/s|Remove-Item +.*-Recurse.*-Force|Remove-Item +.*-Force.*-Recurse)/i.test(flat)
  : new RegExp(CMD + "(rmdir +\\/s|rd +\\/s|Remove-Item +.*-Recurse.*-Force|Remove-Item +.*-Force.*-Recurse)", "i").test(flat)) {
  block("BLOQUEADO: remoção recursiva forçada (equivalente Windows de rm -rf). Delete arquivos individualmente e explique o motivo no artifact.");
}

// destruição de histórico/working tree
if (hit("git" + GITOPTS + " +reset +--hard")) {
  block("BLOQUEADO: git reset --hard descarta trabalho. Use stash ou branch (GOVERNANCE.md §2).");
}
if (hit("git" + GITOPTS + " +clean +-[a-zA-Z]*f")) {
  block("BLOQUEADO: git clean com -f apaga arquivos não rastreados. Revise manualmente o que remover.");
}

// DDL destrutivo direto via CLI de banco (regra inviolável do Data-Engineer,
// até então sem trava mecânica). Escopo estreito para evitar falso positivo.
if (hit("(psql|mysql)\\b") && /(DROP +(TABLE|DATABASE|SCHEMA)|TRUNCATE +)/i.test(flat)) {
  block("BLOQUEADO: DDL destrutivo (DROP/TRUNCATE) via CLI de banco. Operação destrutiva exige aprovação do Tech Lead (manual do Data-Engineer; GOVERNANCE.md §6).");
}

// Escrita nas zonas protegidas POR SHELL. O protect-guardrails.mjs só intercepta
// Write|Edit|MultiEdit|NotebookEdit, e o deny do settings.json só cobre essas mesmas
// ferramentas — um `cp`/`tee`/`>` para .claude/hooks/ não passava por trava nenhuma.
// Ler continua liberado (cat, grep, node .claude/hooks/x.mjs): só o verbo que MUTA bloqueia.
//
// Verbo e caminho têm de estar no MESMO comando: `cat .claude/settings.json ; rm tmp.txt`
// é leitura seguida de uma remoção qualquer, não escrita em zona protegida. A exceção é
// entrar na zona com `cd`/`pushd` — aí o caminho relativo do comando seguinte já é a zona
// (`cd .claude && cp x settings.json`), e qualquer verbo que muta bloqueia.
// `.claude/workflows/` entra porque o playbook-task.js é quem devolve `done` (ADR-005), e
// `.claude/agents/` porque o frontmatter define tools e modelo de cada agente.
const PROTEGIDO = "(\\.claude\\/(settings\\.json|(hooks|workflows|agents)(\\/|\\b))|(^|[ \\/])GOVERNANCE\\.md)";
// O verbo é palavra inteira seguida de espaço: `ln=5` é variável, `platform` não é `rm`.
const MUTANTES = "(?<![\\w.=-])(cp|mv|tee|install|ln|dd|truncate|rm|chmod|chown|rsync|sed +-[a-z]*i|perl +-[a-z]*[ip]|python3? +-c|git +(?:checkout|restore|apply|mv|rm))(?=\\s|$)";
const REDIRECT = new RegExp(">>?\\s*\\S*" + PROTEGIDO);
// Só `.claude` ou uma pasta protegida — `.claude/worktrees/` é onde o Claude Code cria worktrees.
const entrouNaZona = hit("(cd|pushd) +\\S*\\.claude(\\/(hooks|workflows|agents))?\\/?( |$|[;&|)])");

const escreveNaZona = (texto, ancorado) =>
  new RegExp(PROTEGIDO).test(texto)
  && (new RegExp((ancorado ? CMD : "") + MUTANTES).test(texto) || REDIRECT.test(texto));

const zonaViaCd = entrouNaZona && (hit(MUTANTES) || />>?\s*\S/.test(flat));
// "Mesmo comando" = entre separadores de COMANDO (; && || | &) no nível de cima: fora de
// aspas, de `$(…)` e de crase. Parêntese, `$(` e o que vai entre aspas estão DENTRO do
// comando em `python3 -c "import shutil; shutil.copy('x','.claude/settings.json')"`,
// `cp $(ls x) .claude/hooks/y` e `sed -i 's/\(a\)/b/' GOVERNANCE.md`. Aspas desbalanceadas
// → o comando inteiro é um segmento só (conservador).
const comandos = (s) => {
  const out = [];
  let cur = "", q = null, sub = 0, crase = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q !== "'" && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "`") { crase = !crase; cur += c; continue; }
    if (c === "$" && s[i + 1] === "(") { sub++; cur += "$("; i++; continue; }
    if (c === ")" && sub > 0) { sub--; cur += c; continue; }
    if (!sub && !crase && (c === ";" || c === "|" || c === "&")) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  if (q || sub || crase) return [s];
  return out;
};
const paraCasar = (s) => s.replace(/['"]/g, "").replace(/\/(?:\.\/)+/g, "/").replace(/\/{2,}/g, "/").trim();
if (zonaViaCd || comandos(norm).some((s) => escreveNaZona(paraCasar(s), !WRAPPER))) {
  block("BLOQUEADO: escrita em zona protegida (.claude/settings.json, .claude/hooks/, .claude/workflows/, .claude/agents/, GOVERNANCE.md) via shell. Estes arquivos são as travas do playbook e só o Tech Lead os altera, à mão, fora da sessão do agente (GOVERNANCE.md §6). Patch pronto vai para docs/patches/.");
}

process.exit(0);
