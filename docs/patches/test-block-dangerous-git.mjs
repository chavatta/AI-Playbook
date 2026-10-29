#!/usr/bin/env node
// Banco de payloads para block-dangerous-git.mjs.
// Uso: node test-hook.mjs <caminho-do-hook>
import { spawnSync } from "node:child_process";

const HOOK = process.argv[2];

// [descricao, comando, esperado] — BLOCK = deve bloquear, ALLOW = deve passar
const CASES = [
  // ---- devem BLOQUEAR (regressao seria catastrofica) ----
  ["push direto main",            "git push origin main", "BLOCK"],
  ["push -u main",                "git push -u origin main", "BLOCK"],
  ["push refspec HEAD:main",      "git push origin HEAD:main", "BLOCK"],
  ["push refspec branch:main",    "git push origin feat/x:main", "BLOCK"],
  ["push master",                 "git push origin master", "BLOCK"],
  ["force push",                  "git push --force origin foo", "BLOCK"],
  ["force push -f",               "git push -f origin foo", "BLOCK"],
  ["force-with-lease",            "git push --force-with-lease origin foo", "BLOCK"],
  ["refspec forcado +",           "git push origin +foo:bar", "BLOCK"],
  ["rm -rf",                      "rm -rf /tmp/x", "BLOCK"],
  ["rm -fr",                      "rm -fr /tmp/x", "BLOCK"],
  ["rm -rf apos &&",              "cd /tmp && rm -rf x", "BLOCK"],
  ["Remove-Item recursivo",       "Remove-Item -Recurse -Force C:\\x", "BLOCK"],
  ["rmdir /s",                    "rmdir /s C:\\x", "BLOCK"],
  ["reset --hard",                "git reset --hard HEAD~1", "BLOCK"],
  ["clean -f",                    "git clean -f", "BLOCK"],
  ["clean -fd",                   "git clean -fd", "BLOCK"],
  ["clean -f apos &&",            "cd repo && git clean -fd", "BLOCK"],
  ["clean -f apos ;",             "echo oi; git clean -f", "BLOCK"],
  ["psql DROP TABLE",             'psql -c "DROP TABLE users"', "BLOCK"],
  ["mysql TRUNCATE",              'mysql -e "TRUNCATE logs"', "BLOCK"],
  // ---- novos: casos que o hook ANTIGO deixava passar ou quebravam ----
  ["clean -f ofuscado por aspas", 'git clean -"f"', "BLOCK"],
  ["reset --hard em nova linha",  "echo a\ngit reset --hard", "BLOCK"],
  ["clean -f em nova linha",      "echo a\ngit clean -fd", "BLOCK"],
  ["clean -f via bash -c",        'bash -c "git clean -fd"', "BLOCK"],
  ["rm -rf via eval",             'eval "rm -rf /tmp/x"', "BLOCK"],
  ["clean -f com env prefix",     "FOO=1 git clean -fd", "BLOCK"],
  ["clean -f em subshell",        "(git clean -fd)", "BLOCK"],
  ["rm -rf em pipe",              "echo x | rm -rf /tmp/y", "BLOCK"],

  // ---- zona protegida: escrita por shell deve BLOQUEAR ----
  ["cp para hooks",               "cp /tmp/x.mjs .claude/hooks/block-dangerous-git.mjs", "BLOCK"],
  ["cp para settings",            "cp /tmp/s.json .claude/settings.json", "BLOCK"],
  ["mv para hooks",               "mv /tmp/x.mjs .claude/hooks/x.mjs", "BLOCK"],
  ["redirect para hooks",         "echo x > .claude/hooks/x.mjs", "BLOCK"],
  ["append em GOVERNANCE",        "echo x >> GOVERNANCE.md", "BLOCK"],
  ["tee em hooks",                "echo x | tee .claude/hooks/x.mjs", "BLOCK"],
  ["sed -i em GOVERNANCE",        "sed -i s/a/b/ GOVERNANCE.md", "BLOCK"],
  ["rm de hook",                  "rm .claude/hooks/protect-guardrails.mjs", "BLOCK"],
  ["cp com caminho absoluto",     "cp /tmp/x /Users/u/repo/.claude/hooks/x.mjs", "BLOCK"],

  // ---- zona protegida: LEITURA deve PASSAR ----
  ["rodar o hook (teste)",        "node docs/patches/test-block-dangerous-git.mjs .claude/hooks/block-dangerous-git.mjs", "ALLOW"],
  ["ler settings",                "cat .claude/settings.json", "ALLOW"],
  ["grep em hooks",               'grep -n block .claude/hooks/block-dangerous-git.mjs', "ALLOW"],
  ["ler GOVERNANCE",              "head -40 GOVERNANCE.md", "ALLOW"],
  ["diff de GOVERNANCE",          "git diff GOVERNANCE.md", "ALLOW"],
  ["cp para docs/patches",        "cp /tmp/x.mjs docs/patches/block-dangerous-git.mjs", "ALLOW"],

  // ---- devem PASSAR (falsos positivos que motivaram o fix) ----
  ["grep do texto clean -f",      'grep "git clean -f" arquivo.md', "ALLOW"],
  ["grep -c com escape",          'grep -c "git clean -f\\` (qualquer variante" DESENVOLVIMENTO-COM-IA.md', "ALLOW"],
  ["rg do texto rm -rf",          'rg "rm -rf" docs/', "ALLOW"],
  ["echo citando reset",          'echo "nunca rode git reset --hard"', "ALLOW"],
  ["grep reset --hard",           'grep -n "git reset --hard" GOVERNANCE.md', "ALLOW"],
  ["grep push main",              'grep "git push origin main" DESENVOLVIMENTO-COM-IA.md', "ALLOW"],
  ["grep Remove-Item",            'grep "Remove-Item -Recurse -Force" docs/x.md', "ALLOW"],
  // ---- devem PASSAR (uso legitimo) ----
  ["push branch normal",          "git push origin feat/conformidade", "ALLOW"],
  ["push main-backup",            "git push origin main-backup", "ALLOW"],
  ["push -u branch normal",       "git push -u origin feat/x", "ALLOW"],
  ["clean dry-run",               "git clean -n", "ALLOW"],
  ["rm arquivo unico",            "rm arquivo.txt", "ALLOW"],
  ["git status",                  "git status --short", "ALLOW"],
  ["reset soft",                  "git reset --soft HEAD~1", "ALLOW"],
  ["psql SELECT",                 'psql -c "SELECT * FROM users"', "ALLOW"],
  ["worktree remove",             "git worktree remove .claude/worktrees/x", "ALLOW"],

  // ---- 2026-09: falsos positivos reportados em 2026-09-15 — devem PASSAR ----
  ["push branch + PR em 2 linhas",  "git push -u origin feat/x\ngh pr create --draft --base main", "ALLOW"],
  ["push branch && PR --base main", "git push -u origin feat/x && gh pr create --draft --base main", "ALLOW"],
  ["commit -F heredoc cita push",   "git commit -F - <<'EOF'\nBloqueia git push origin main\nEOF", "ALLOW"],
  ["commit -m $(cat heredoc)",      "git commit -m \"$(cat <<'EOF'\nDocumenta git push origin main\nEOF\n)\"", "ALLOW"],
  ["doc gravado por heredoc",       "cat > docs/x.md <<'EOF'\ngit push origin main e bloqueado\nrm -rf /tmp/x tambem\nEOF", "ALLOW"],
  ["commit -m multilinha",          "git commit -m \"Titulo\n\ngit push origin main e bloqueado\"", "ALLOW"],
  ["commit -m cita push em main",   'git commit -m "explica por que git push em main e bloqueado"', "ALLOW"],
  ["push branch ; rm -f arquivo",   "git push origin feat/x ; rm -f tmp.txt", "ALLOW"],
  ["ler settings ; rm arquivo",     "cat .claude/settings.json ; rm tmp.txt", "ALLOW"],
  ["suite && rm arquivo",           "node docs/patches/test-block-dangerous-git.mjs .claude/hooks/block-dangerous-git.mjs && rm -f /tmp/out.txt", "ALLOW"],
  ["git -C push branch",            "git -C repo push origin feat/x", "ALLOW"],
  ["gh pr --base main sozinho",     "gh pr create --draft --base main", "ALLOW"],
  ["cd worktree && rm arquivo",     "cd .claude/worktrees/x && rm tmp.txt", "ALLOW"],
  ["variavel ln= e leitura",        "ln=5; cat .claude/hooks/x.mjs", "ALLOW"],
  ["ler settings | tee outro",      "grep foo .claude/settings.json | tee out.txt", "ALLOW"],
  ["ler workflow",                  "cat .claude/workflows/playbook-task.js", "ALLOW"],
  ["cp para worktrees",             "cp /tmp/x .claude/worktrees/y/x.txt", "ALLOW"],

  // ---- 2026-09: o que a correcao NAO pode afrouxar — devem BLOQUEAR ----
  ["heredoc para bash",             "bash <<'EOF'\nrm -rf /tmp/x\nEOF", "BLOCK"],
  ["cat heredoc | bash",            "cat <<'EOF' | bash\ngit clean -fd\nEOF", "BLOCK"],
  ["heredoc para python",           "python3 - <<'EOF'\nimport os; os.system('git push origin main')\nEOF", "BLOCK"],
  ["heredoc sem fechamento",        "cat <<EOF\ngit clean -fd", "BLOCK"],
  // achado HIGH do security-sre (2026-09-23): `<<` colado ao interpretador
  ["bash<<EOF colado",              "bash<<'EOF'\nrm -rf /tmp/x\nEOF", "BLOCK"],
  ["sh<<EOF colado",                "sh<<'EOF'\ngit clean -fd\nEOF", "BLOCK"],
  ["/bin/bash<<-EOF colado",        "/bin/bash<<-'EOF'\n\trm -rf /tmp/x\n\tEOF", "BLOCK"],
  ["python3<<EOF colado",           "python3<<'EOF'\nimport os; os.system('git push origin main')\nEOF", "BLOCK"],
  ["node<<EOF colado",              "node<<'EOF'\nrequire('child_process').execSync('git reset --hard')\nEOF", "BLOCK"],
  ["herestring para bash",          "bash <<< 'rm -rf /tmp/x'", "BLOCK"],
  ["herestring colado",             "bash<<<'git clean -fd'", "BLOCK"],
  ["cat>doc<<EOF colado (dado)",    "cat>docs/x.md<<'EOF'\ngit push origin main e bloqueado\nEOF", "ALLOW"],
  ["herestring para grep (dado)",   "grep main <<< 'git push origin main'", "ALLOW"],
  // achado HIGH do reviewer (2026-09-23): parêntese/`$(`/crase não separam comando
  ["python3 -c open() em hook",     "python3 -c \"open('.claude/hooks/x.mjs','w').write('')\"", "BLOCK"],
  ["python3 -c shutil em settings", "python3 -c \"import shutil; shutil.copy('/tmp/s.json','.claude/settings.json')\"", "BLOCK"],
  ["bash -c python3 -c em hook",    "bash -c \"python3 -c \\\"open('.claude/hooks/x.mjs','w')\\\"\"", "BLOCK"],
  ["cp $(ls) para hook",            "cp $(ls /tmp/x.mjs) .claude/hooks/y.mjs", "BLOCK"],
  ["mv $(echo) para settings",      "mv $(echo /tmp/s.json) .claude/settings.json", "BLOCK"],
  ["tee $(echo hook)",              "echo x | tee $(echo .claude/hooks/y.mjs)", "BLOCK"],
  ["sed -i com grupo \\( \\)",      "sed -i 's/\\(a\\)/b/' .claude/hooks/x.mjs", "BLOCK"],
  ["cp de arquivo com parenteses",  "cp '/tmp/x (1).mjs' .claude/hooks/y.mjs", "BLOCK"],
  ["leitura em subshell",           "echo $(cat .claude/hooks/x.mjs)", "ALLOW"],
  ["leitura em subshell ; rm",      "(cat .claude/settings.json) ; rm tmp.txt", "ALLOW"],
  // heredoc grava script e o roda depois — o corpo é código
  ["heredoc grava .sh e roda",      "cat > s.sh <<'EOF'\nrm -rf /tmp/x\nEOF\nsh s.sh", "BLOCK"],
  ["heredoc grava e ./roda",        "cat > s <<'EOF'\ngit clean -fd\nEOF\nchmod +x s && ./s", "BLOCK"],
  ["heredoc grava e roda por caminho absoluto", "cat > /tmp/s <<'EOF'\nrm -rf /tmp/x\nEOF\nchmod +x /tmp/s; /tmp/s", "BLOCK"],
  ["heredoc grava e roda via $PWD",  "cat > s <<'EOF'\ngit clean -fd\nEOF\n$PWD/s", "BLOCK"],
  ["heredoc grava e exec",          "cat > /tmp/s <<'EOF'\ngit reset --hard\nEOF\nexec /tmp/s", "BLOCK"],
  ["heredoc | tee e roda por caminho", "cat <<'EOF' | tee /tmp/s\nrm -rf /tmp/x\nEOF\nchmod +x /tmp/s; /tmp/s", "BLOCK"],
  ["heredoc dd of= e roda por caminho", "dd of=/tmp/s <<'EOF'\ngit clean -fd\nEOF\nchmod +x /tmp/s; /tmp/s", "BLOCK"],
  ["heredoc grava e roda via env",  "tee /tmp/s <<'EOF'\ngit reset --hard\nEOF\nenv /tmp/s", "BLOCK"],
  ["heredoc grava e roda via sudo -u", "cat > /tmp/s <<'EOF'\nrm -rf /tmp/x\nEOF\nsudo -u x /tmp/s", "BLOCK"],
  ["heredoc grava e roda via timeout", "cat > /tmp/s <<'EOF'\ngit clean -fd\nEOF\ntimeout 5 /tmp/s", "BLOCK"],
  ["doc gravado e git add no mesmo comando", "cat > docs/x.md <<'EOF'\ngit push origin main e bloqueado\nEOF\ngit add docs/x.md", "ALLOW"],
  ["doc em caminho absoluto, sem rodar", "cat > /tmp/notas.md <<'EOF'\ngit push origin main e bloqueado\nEOF", "ALLOW"],
  ["heredoc grava .mjs citando push","cat > docs/patches/x.mjs <<'EOF'\n// git push origin main e bloqueado\nEOF", "ALLOW"],
  ["dois heredocs na mesma linha","cat <<A <<B\nx\nA\ngit clean -fd\nB", "ALLOW"],
  // achado HIGH do security-sre, rodada 2: heredoc para CLI de banco é SQL executado
  ["psql <<EOF DROP TABLE",         "psql dbname <<'EOF'\nDROP TABLE users;\nEOF", "BLOCK"],
  ["psql <<EOF TRUNCATE",           "psql <<'EOF'\nTRUNCATE logs;\nEOF", "BLOCK"],
  ["mysql <<EOF DROP DATABASE",     "mysql db <<'EOF'\nDROP DATABASE app;\nEOF", "BLOCK"],
  ["psql -f - <<EOF DROP",          "psql -f - <<'EOF'\nDROP TABLE users;\nEOF", "BLOCK"],
  ["psql<<EOF colado DROP",         "psql<<'EOF'\nDROP SCHEMA public;\nEOF", "BLOCK"],
  ["psql <<EOF SELECT",             "psql dbname <<'EOF'\nSELECT count(*) FROM users;\nEOF", "ALLOW"],
  // SUG-1 do reviewer: outras vias de escrita na zona
  ["rsync para hooks",              "rsync -a /tmp/h/ .claude/hooks/", "BLOCK"],
  ["caminho com /./",               "cp /tmp/x .claude/./hooks/x.mjs", "BLOCK"],
  ["caminho com //",                "cp /tmp/x .claude//hooks/x.mjs", "BLOCK"],
  ["git checkout -- settings",      "git checkout feat -- .claude/settings.json", "BLOCK"],
  ["git restore hook",              "git restore --source=HEAD~3 .claude/hooks/x.mjs", "BLOCK"],
  ["git rm de hook",                "git rm .claude/hooks/protect-guardrails.mjs", "BLOCK"],
  ["git diff de settings",          "git diff feat -- .claude/settings.json", "ALLOW"],
  ["git log de hooks",              "git log --oneline -- .claude/hooks/", "ALLOW"],
  ["git checkout de branch",        "git checkout -b feat/x", "ALLOW"],
  ["heredoc grava hook",            "cat > .claude/hooks/x.mjs <<'EOF'\nconsole.log(1)\nEOF", "BLOCK"],
  ["tee heredoc em GOVERNANCE",     "tee GOVERNANCE.md <<'EOF'\nx\nEOF", "BLOCK"],
  ["commit && push main",           'git commit -m "x" && git push origin main', "BLOCK"],
  ["push main apos linha citada",   'echo "a"\ngit push origin main', "BLOCK"],
  ["aspas desbalanceadas + linha",  "echo don't\ngit clean -fd", "BLOCK"],
  ["git -C push main",              "git -C repo push origin main", "BLOCK"],
  ["git --git-dir push main",       "git --git-dir .git push origin main", "BLOCK"],
  ["git -C push --force",           "git -C repo push --force origin foo", "BLOCK"],
  ["cd hooks && cp",                "cd .claude/hooks && cp /tmp/x.mjs y.mjs", "BLOCK"],
  ["cd .claude && cp settings",     "cd .claude && cp /tmp/s.json settings.json", "BLOCK"],
  ["bash -c cp para hooks",         'bash -c "cp /tmp/x .claude/hooks/x.mjs"', "BLOCK"],
  ["cp para workflows",             "cp /tmp/x.js .claude/workflows/playbook-task.js", "BLOCK"],
  ["redirect para agents",          "echo x > .claude/agents/reviewer.md", "BLOCK"],
  ["sed -i em agents",              "sed -i s/opus/haiku/ .claude/agents/reviewer.md", "BLOCK"],
  ["cd workflows && mv",            "cd .claude/workflows && mv /tmp/x.js playbook-task.js", "BLOCK"],
  ["heredoc grava workflow",        "cat > .claude/workflows/playbook-task.js <<'EOF'\nexport const meta = {}\nEOF", "BLOCK"],
];

let pass = 0, fail = 0;
const failures = [];

for (const [desc, command, want] of CASES) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  const got = r.status === 2 ? "BLOCK" : "ALLOW";
  if (got === want) { pass++; }
  else { fail++; failures.push(`  [${want} esperado, veio ${got}]  ${desc}  ::  ${JSON.stringify(command)}`); }
}

console.log(HOOK);
console.log(`  passou: ${pass}/${CASES.length}   falhou: ${fail}`);
if (failures.length) console.log(failures.join("\n"));
