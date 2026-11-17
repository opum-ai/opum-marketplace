// OMARK-101 (DEC-240 items 1-4). Keeps the CI hardening from regressing.
//
// A line-based reader, deliberately: this repository has no YAML dependency and
// installing one in CI would be the supply-chain exposure DEC-240 is closing.
// The workflow files here use one layout (block `run: |` or single-line `run:`,
// steps as `- ` list items), which is all this reads.
//
// Both ways: the real workflows must produce zero violations, AND each rule must
// reject a deliberately bad fixture. A checker that was only ever shown clean
// input could be a checker that finds nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfDir = path.join(here, '..', '..', '.github', 'workflows');

const indentOf = (l) => l.length - l.trimStart().length;

// Split a workflow into steps: each step is the lines from its `- ` list item up
// to (not including) the next list item at the same indent or a dedent.
function steps(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // Every key a step may open with. A step that begins `- shell:` or
    // `- working-directory:` would otherwise be skipped entirely and every rule
    // below would never see it (OMARK-102 finding 4).
    // `-\s+` and an optionally quoted key: `-  run:` and `- "run":` are the same step
    // (OMARK-106 LOW-4).
    const m = lines[i].match(/^(\s*)-\s+["']?(name|uses|run|id|if|env|with|shell|working-directory|timeout-minutes|continue-on-error)["']?\s*:/);
    if (!m) continue;
    const ind = m[1].length;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > ind)) j++;
    out.push({ line: i + 1, ind, lines: lines.slice(i, j) });
  }
  return out;
}

// The text a step hands to the shell: the single-line `run:` value or the block.
function runText(step) {
  const out = [];
  const L = step.lines;
  for (let k = 0; k < L.length; k++) {
    // Optional quotes around the key and any run of spaces after the dash (OMARK-106 LOW-4).
    const m = L[k].match(/^(\s*)(-\s+)?["']?run["']?\s*:\s*(.*)$/);
    if (!m) continue;
    const ind = m[1].length + (m[2] ? m[2].length : 0);
    // A block-scalar header: | or > with an optional chomping (-/+) and indentation
    // indicator (1-9) in either order, then an optional comment. The old test accepted only
    // a bare marker, so `run: |2` or `run: | # note` was read as a one-line value
    // and the body below it was never scanned (OMARK-106 LOW-4).
    if (m[3] && !/^[|>](?:[1-9][-+]?|[-+][1-9]?)?\s*(?:#.*)?$/.test(m[3])) { out.push(m[3]); continue; }
    for (let q = k + 1; q < L.length; q++) {
      if (L[q].trim() !== '' && indentOf(L[q]) <= ind) break;
      out.push(L[q]);
    }
  }
  return out.join('\n');
}

// Shell continuation lines are one command: join them before any rule reads a
// line, or `npm install \\\n  -g pkg` hides its -g on the next physical line.
const joinContinuations = (t) => t.replace(/\\\n\s*/g, ' ');

// OMARK-106 LOW-3: the rules below run per SHELL COMMAND, not per line, and look for the
// flag with comments removed. `npm ci --ignore-scripts && npm rebuild` is two commands and
// only the first carries the flag; `npm install # --ignore-scripts` carries it only in a
// comment.
// Round-2 review (blockers 3 and 4): the split and the comment strip are QUOTE-AWARE. A
// quote-unaware split cut `x="|#" npm ci` into pieces and dropped the one holding npm, and
// cut `"--ignore-scripts;"` into a token that looked like the bare flag. The scanner walks a
// line tracking ' and " (and backslash escapes outside single quotes) and splits on ; & |
// only OUTSIDE quotes; a `#` outside quotes that starts the line or follows whitespace
// begins a comment. An unterminated quote keeps the rest of the line in one piece, which
// can only over-report. A piece is never dropped once split, except one that is nothing but
// a comment.
// Because the scanner itself stops at a real comment, the text it returns is already
// comment-free; `raw` and `flagText` are the same string.
export const commands = (run) => {
  const out = [];
  for (const ln of run.split('\n')) {
    let q = null, start = 0, end = ln.length;
    const pieces = [];
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i];
      if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
      if (c === '\\') { i++; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(ln[i - 1]))) { end = i; break; }
      if (c === ';' || c === '&' || c === '|') {
        pieces.push(ln.slice(start, i));
        if (ln[i + 1] === c && c !== ';') i++;
        start = i + 1;
      }
    }
    pieces.push(ln.slice(start, end));
    for (const p of pieces) { const t = p.trim(); if (t !== '') out.push({ raw: t, flagText: t }); }
  }
  return out;
};

// The npm binary as a command word, whether bare, quoted or path-prefixed (`"npm"`,
// `/usr/bin/npm`, `./node_modules/.bin/npm`): OMARK-106 LOW-2. `npx` is always a risk.
// Review B2: a word ends at whitespace OR ) > < or a backtick, so `(cd sub && npm ci)`,
// `$(npm ci)`, a backticked npm ci, `npm ci>/dev/null` and `$(which npm) ci` are seen.
const NPM_TOKEN = /(?:^|[\s(`])["']?(?:[^\s"'()`]*\/)?(npx|npm)["']?(?=[\s)<>`]|$)/;
// The npm subcommands that can run a dependency's lifecycle script, including their
// aliases and the abbreviations npm accepts (install: i in ins inst insta instal isnt;
// clean-install: ci ic isntall-clean sit; install-test: it; install-ci-test: cit;
// update: up upgrade udpate; dedupe: ddp find-dupes; link: ln; init: innit; create; exec: x;
// rebuild: rb), plus `audit fix`. NOT listed on purpose, and recorded on OMARK-106:
// run / test / start (they run the ROOT package's own scripts, not a dependency's) and
// pack / publish / version (they run the root package's lifecycle only).
const NPM_SUB = /(?:^|\s)["']?(?:i|in|ins|inst|insta|instal|install|isntall|add|ci|clean-install|ic|install-clean|isntall-clean|sit|install-test|it|cit|install-ci-test|update|up|upgrade|udpate|dedupe|ddp|find-dupes|link|ln|init|innit|create|exec|x|rebuild|rb)["']?(?=[\s)<>`]|$)|(?:^|\s)audit\s+fix\b/;
// A match whose word comes DIRECTLY after npm and is one of these runs only the root
// package's own scripts: `npm run ci` is a script named ci, not `npm ci`. The shortcut is
// taken only when the safe word is the very next word (round-2 blocker 1: `npm --prefix test
// ci` has a flag value `test` before the subcommand and must still be scanned). The
// recorded decline of pack/publish/version rests on "they run the root package's lifecycle
// only"; that was NOT verified (`npm pack <git-spec>` may prepare a git dependency), and
// they are not on NPM_SUB either way.
const NPM_SAFE_FIRST = new Set(['run', 'run-script', 'rum', 'urn', 'test', 'tst', 't', 'start', 'stop', 'restart', 'pack', 'publish', 'version', 'view', 'config', 'help', 'ls', 'list', 'root', 'prefix', 'bin']);
// EVERY npm word in the piece is judged (round-2 blocker 2), each against the text up to the
// next npm word, so a nested `npm test $(npm install x)` or `echo npm test $(npm ci)` is
// seen even though the first npm's own first word is safe.
export const npmRisk = (cmd) => {
  const ms = [...cmd.matchAll(new RegExp(NPM_TOKEN.source, 'g'))];
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    if (m[1] === 'npx') return true;
    const from = m.index + m[0].length;
    const rest = cmd.slice(from, k + 1 < ms.length ? ms[k + 1].index : cmd.length);
    const first = rest.split(/[\s)<>`]+/).map((t) => t.replace(/^["']|["']$/g, '')).find((t) => t);
    if (NPM_SAFE_FIRST.has(first)) continue;
    if (NPM_SUB.test(rest)) return true;
  }
  return false;
};

// --ignore-scripts must be present AND not switched back off: `--ignore-scripts=false`
// contains the word and means the opposite (OMARK-102 finding 2).
// A DENYLIST of off-values (=false, =0) is evadable (=00, =null, an empty =), so this
// is an allowlist over EVERY occurrence in the command: each must be exactly the bare
// flag or =true, and at least one must exist (review LOW-1).
// OMARK-106: an occurrence is the whole whitespace-delimited token, so a prefix stuck to the
// flag (`''--ignore-scripts=false`, `\\--ignore-scripts=false`) is not the bare flag and is
// refused; and a bare flag followed by a boolean-looking word (`--ignore-scripts false`) is
// refused too, because npm's option parser reads that next word as the flag's value.
const hasIgnoreScripts = (cmd) => {
  const re = /\S*--(?:no-)?ignore-scripts\S*/g;
  const occ = [...cmd.matchAll(re)];
  if (occ.length === 0) return false;
  return occ.every((m) => {
    // A closing ) or backtick ends the word (`(cd sub && npm ci --ignore-scripts)`), but only
    // when it is UNMATCHED in the command: `npm ci $(: --ignore-scripts)` and a backticked
    // no-op keep theirs, so the token is not the bare flag (round-2 nit 6).
    let t = m[0];
    const cnt = (ch) => cmd.split(ch).length - 1;
    if (t.endsWith(')') && cnt(')') > cnt('(')) t = t.slice(0, -1);
    else if (t.endsWith('`') && cnt('`') % 2 === 1) t = t.slice(0, -1);
    const tok = t.replace(/^["']|["']$/g, '');
    if (tok === '--ignore-scripts=true') return true;
    if (tok !== '--ignore-scripts') return false;
    return !/^\s+["']?(true|false|null|undefined|[0-9]+)["']?(?=[\s)<>`;&|]|$)/i.test(cmd.slice(m.index + m[0].length));
  });
};

// Flow-style YAML (`- { run: npm ci }`, `steps: [ ... ]`) is not a layout this line reader
// understands, so it is refused outright rather than read as a step-less file
// (OMARK-106 LOW-4).
const flowStyle = (text) => text.split('\n').map((l, i) => [l, i + 1])
  .filter(([l]) => !/^\s*#/.test(l) && (/^\s*-\s*\{/.test(l) || /^\s*["']?steps["']?\s*:\s*\[/.test(l) || /\{[^}]*\brun\s*:/.test(l)));

// Workflow files are *.yml AND *.yaml (OMARK-106 LOW-4: the .yml-only filter skipped .yaml).
export const isWorkflowFile = (f) => /\.ya?ml$/.test(f);

export function violations(file, text) {
  const v = [];
  for (const [, n] of flowStyle(text)) v.push(`${file}:${n}: flow-style YAML (a { } step or steps: [ ]) is not read by this checker; write block style`);
  const all = steps(text);
  all.forEach((s, idx) => {
    const body = s.lines.join('\n');
    const run = joinContinuations(runText(s));
    // Item 2: every checkout opts out of persisting the token...
    if (/uses:\s*actions\/checkout@/.test(body)) {
      if (!/persist-credentials:\s*false\b/.test(body)) {
        v.push(`${file}:${s.line}: actions/checkout does not set persist-credentials: false`);
      }
      // ...and the result is READ right after, not trusted.
      const next = all[idx + 1];
      if (!next || !runText(next).includes('scripts/ci/assert-no-persisted-credential.sh')) {
        v.push(`${file}:${s.line}: the step after actions/checkout does not run scripts/ci/assert-no-persisted-credential.sh`);
      }
    }
    // Item 4: nothing is interpolated into a shell body.
    if (run.includes('${{')) {
      v.push(`${file}:${s.line}: a \${{ }} expression is interpolated inside run: (pass it through env:)`);
    }
    // Item 1: any npm install/ci/exec or npx, global or not, must not run dependency
    // lifecycle scripts.
    for (const { raw, flagText } of commands(run)) {
      if (npmRisk(raw) && !hasIgnoreScripts(flagText)) {
        v.push(`${file}:${s.line}: npm/npx command without --ignore-scripts: ${raw}`);
      }
    }
    // Item 3: the Quest version is read by the one bounded script and by nothing
    // else. Any run that names the declaring phrase, or reads CLAUDE.md without
    // going through that script, is a second reader (sed, grep, awk, perl, cut...).
    if (/Quest CLI/.test(run)) {
      v.push(`${file}:${s.line}: a run: body names the 'Quest CLI' declaring phrase; use scripts/ci/read-quest-version.sh`);
    }
    if (/CLAUDE\.md/.test(run) && !/scripts\/ci\/read-quest-version\.sh/.test(run)) {
      v.push(`${file}:${s.line}: a run: body reads CLAUDE.md without scripts/ci/read-quest-version.sh`);
    }
  });
  return v;
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const no = (m, d) => { fail++; console.log(`  FAIL ${m}`); if (d) console.log(`       | ${d}`); };

// --- the real workflows are clean, and we really read them ----------------
const files = readdirSync(wfDir).filter(isWorkflowFile).sort();
let stepCount = 0, checkouts = 0, installs = 0, runBlocks = 0, readers = 0;
for (const f of files) {
  const text = readFileSync(path.join(wfDir, f), 'utf8');
  for (const s of steps(text)) {
    stepCount++;
    const rt = joinContinuations(runText(s));
    if (/uses:\s*actions\/checkout@/.test(s.lines.join('\n'))) checkouts++;
    if (rt) runBlocks++;
    if (commands(rt).some((c) => npmRisk(c.raw))) installs++;
    if (rt.includes('scripts/ci/read-quest-version.sh')) readers++;
  }
  const v = violations(f, text);
  v.length === 0 ? ok(`${f}: no hardening violations`) : v.forEach((x) => no(x));
}
// Positive control: a reader that found nothing would also report no violations.
stepCount >= 25 ? ok(`read ${stepCount} steps across ${files.length} workflows`) : no(`read only ${stepCount} steps; the reader is not seeing the workflows`);
checkouts === 4 ? ok('found all 4 actions/checkout steps') : no(`expected 4 checkout steps, found ${checkouts}`);
installs === 2 ? ok('found both npm install steps') : no(`expected 2 npm install steps, found ${installs}`);
readers === 2 ? ok('both Quest-version steps go through read-quest-version.sh') : no(`expected 2 steps using read-quest-version.sh, found ${readers}`);
runBlocks >= 10 ? ok(`read ${runBlocks} run: bodies`) : no(`read only ${runBlocks} run: bodies`);

// --- each rule rejects its own bad fixture --------------------------------
const CHECK = '      - name: c\n        run: bash scripts/ci/assert-no-persisted-credential.sh\n';
const CO = '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n';
const wrap = (steps) => `jobs:\n  a:\n    steps:\n${steps}`;
const bad = {
  'checkout without persist-credentials: false': ['persist-credentials', wrap('      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n' + CHECK)],
  'checkout not followed by the credential check': ['does not run scripts/ci/assert-no-persisted-credential.sh', wrap(CO + '      - name: x\n        run: echo hi\n')],
  'checkout as the last step (no step after)': ['does not run scripts/ci/assert-no-persisted-credential.sh', wrap(CO)],
  'a ${{ }} inside run:': ['interpolated inside run', wrap('      - name: x\n        run: |\n          echo "${{ github.base_ref }}"\n')],
  'a single-line run: with ${{ }}': ['interpolated inside run', wrap('      - run: npm install -g --ignore-scripts "x@${{ steps.q.outputs.version }}"\n')],
  'npm install -g without --ignore-scripts': ['without --ignore-scripts', wrap('      - name: i\n        env:\n          V: 1\n        run: npm install -g "@opum-ai/quest@$V"\n')],
  'a backslash-continued npm install -g without --ignore-scripts': ['without --ignore-scripts', wrap('      - name: i\n        run: |\n          npm install \\\n            -g "x@1.2.3"\n')],
  'npx': ['without --ignore-scripts', wrap('      - name: i\n        run: npx some-tool\n')],
  'npm exec': ['without --ignore-scripts', wrap('      - name: i\n        run: npm exec some-tool\n')],
  'a non-global npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci\n')],
  // OMARK-102 findings 2-4. Each needle is the rule's own wording, so a rejection by
  // some OTHER rule cannot satisfy the case.
  '--ignore-scripts=false (the word present, the meaning inverted)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts=false "x@1.2.3"\n')],
  'a bare --ignore-scripts then --ignore-scripts=00 (any occurrence counts)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts --ignore-scripts=00 "x@1.2.3"\n')],
  'a bare --ignore-scripts then --ignore-scripts=null': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts --ignore-scripts=null "x@1.2.3"\n')],
  'a bare --ignore-scripts then an empty --ignore-scripts=': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts --ignore-scripts= "x@1.2.3"\n')],
  '--no-ignore-scripts': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --no-ignore-scripts "x@1.2.3"\n')],
  'a flag placed before the subcommand (npm -g install)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm -g install "x@1.2.3"\n')],
  'npm rebuild': ['without --ignore-scripts', wrap('      - name: i\n        run: npm rebuild\n')],
  'npm install-test': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install-test\n')],
  'a step opening with shell: (npm ci inside it)': ['without --ignore-scripts', wrap('      - shell: bash\n        run: npm ci\n')],
  'a step opening with working-directory: (npm ci inside it)': ['without --ignore-scripts', wrap('      - working-directory: sub\n        run: npm ci\n')],
  'a step opening with timeout-minutes: carrying a ${{ }} in run:': ['interpolated inside run', wrap('      - timeout-minutes: 5\n        run: echo "${{ github.base_ref }}"\n')],
  // OMARK-106. Each needle is the rule's own wording.
  'LOW-3: the flag on one command, a later npm rebuild without it (&&)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci --ignore-scripts && npm rebuild\n')],
  'LOW-3: the flag on one command, a later npm install after ;': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci --ignore-scripts; npm install x\n')],
  'LOW-3: the flag only inside a trailing comment': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install x # --ignore-scripts\n')],
  'LOW-3: the flag only in a whole-line comment in a block': ['without --ignore-scripts', wrap('      - name: i\n        run: |\n          # --ignore-scripts\n          npm ci\n')],
  'LOW-4: two spaces after the step dash': ['without --ignore-scripts', wrap('      -  run: npm ci\n')],
  'LOW-4: a quoted run key': ['without --ignore-scripts', wrap('      - "run": npm ci\n')],
  'LOW-4: a flow-style step': ['flow-style YAML', wrap('      - { run: npm ci }\n')],
  'LOW-4: a flow-style steps list': ['flow-style YAML', 'jobs:\n  a:\n    steps: [ { run: npm ci } ]\n'],
  'LOW-4: a block scalar with an indentation indicator': ['without --ignore-scripts', wrap('      - name: i\n        run: |2\n          npm ci\n')],
  'LOW-4: a block scalar with a trailing comment after the marker': ['without --ignore-scripts', wrap('      - name: i\n        run: | # note\n          npm ci\n')],
  'LOW-4: a block scalar with chomping and a comment (>-)': ['without --ignore-scripts', wrap('      - name: i\n        run: >- # note\n          npm ci\n')],
  'LOW-2: npm update': ['without --ignore-scripts', wrap('      - name: i\n        run: npm update\n')],
  'LOW-2: npm dedupe': ['without --ignore-scripts', wrap('      - name: i\n        run: npm dedupe\n')],
  'LOW-2: npm audit fix': ['without --ignore-scripts', wrap('      - name: i\n        run: npm audit fix\n')],
  'LOW-2: npm link': ['without --ignore-scripts', wrap('      - name: i\n        run: npm link\n')],
  'LOW-2: npm install abbreviation ins': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ins x\n')],
  'LOW-2: npm ic': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ic\n')],
  'LOW-2: npm sit': ['without --ignore-scripts', wrap('      - name: i\n        run: npm sit\n')],
  'LOW-2: npm init': ['without --ignore-scripts', wrap('      - name: i\n        run: npm init x\n')],
  'LOW-2: npm create': ['without --ignore-scripts', wrap('      - name: i\n        run: npm create x\n')],
  'LOW-2: a quoted npm': ['without --ignore-scripts', wrap('      - name: i\n        run: "npm" ci\n')],
  'LOW-2: a path-prefixed npm': ['without --ignore-scripts', wrap('      - name: i\n        run: /usr/bin/npm ci\n')],
  'LOW-2: a node_modules/.bin npm': ['without --ignore-scripts', wrap('      - name: i\n        run: ./node_modules/.bin/npm ci\n')],
  'R2-3: a bare --ignore-scripts then the word false': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts false "x"\n')],
  'R2-4: a bare flag, then empty quotes stuck to a false one': ['without --ignore-scripts', wrap("      - name: i\n        run: npm install -g --ignore-scripts ''--ignore-scripts=false x\n")],
  'R2-4: a bare flag, then a backslash stuck to a false one': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts \\--ignore-scripts=false x\n')],
  // Review B1 / B2: each form must fail, and each was confirmed to pass unflagged on 8bf321d.
  'B1: a quoted space-hash hiding npm ci after &&': ['without --ignore-scripts', wrap('      - name: i\n        run: echo " #" && npm ci\n')],
  'B1: a quoted space-hash in an env assignment before npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: FOO=" #" npm ci\n')],
  'B1: a quoted space-hash then npm install after ;': ['without --ignore-scripts', wrap('      - name: i\n        run: echo "step #1"; npm install x\n')],
  'B2: npm ci inside a subshell': ['without --ignore-scripts', wrap('      - name: i\n        run: (cd sub && npm ci)\n')],
  'B2: npm ci inside $( )': ['without --ignore-scripts', wrap('      - name: i\n        run: x=$(npm ci)\n')],
  'B2: a backticked npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: x=`npm ci`\n')],
  'B2: npm ci with a redirect stuck on': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci>/dev/null\n')],
  'B2: $(which npm) ci': ['without --ignore-scripts', wrap('      - name: i\n        run: $(which npm) ci\n')],
  // Round-2 review blockers 1-5, nit 6 and nit 8. Each, except R2-8, was confirmed NOT rejected on 9b099f3.
  'R2-1: a flag value read as the subcommand (--prefix test)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm --prefix test ci\n')],
  'R2-1: -w test ci': ['without --ignore-scripts', wrap('      - name: i\n        run: npm -w test ci\n')],
  'R2-1: -C bin install': ['without --ignore-scripts', wrap('      - name: i\n        run: npm -C bin install\n')],
  'R2-2: a nested npm install inside npm test $( )': ['without --ignore-scripts', wrap('      - name: i\n        run: npm test $(npm install x)\n')],
  'R2-2: a backticked npm ci after npm run build': ['without --ignore-scripts', wrap('      - name: i\n        run: npm run build `npm ci`\n')],
  'R2-2: echo npm test $(npm ci)': ['without --ignore-scripts', wrap('      - name: i\n        run: echo npm test $(npm ci)\n')],
  'R2-3: a quoted | before a hash then npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: x="|#" npm ci\n')],
  'R2-3: a quoted & then hash': ['without --ignore-scripts', wrap('      - name: i\n        run: FOO="&#" npm ci\n')],
  'R2-4: a double-quoted flag with a stuck ;': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci "--ignore-scripts;"\n')],
  'R2-4: a double-quoted flag with a stuck |x': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci "--ignore-scripts|x"\n')],
  'R2-4: a single-quoted flag with a stuck &': ['without --ignore-scripts', wrap("      - name: i\n        run: npm ci '--ignore-scripts&'\n")],
  'R2-5: a bare flag then false before a redirect': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci --ignore-scripts false>/dev/null\n')],
  'R2-5: a bare flag then false before a closing paren': ['without --ignore-scripts', wrap('      - name: i\n        run: (npm ci --ignore-scripts false)\n')],
  'R2-6: the flag only inside a $( ) that expands to nothing': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci $(: --ignore-scripts)\n')],
  'R2-6: the flag only inside a backticked no-op': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci `: --ignore-scripts`\n')],
  'R2-8: npm run ci followed by a real npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: npm run ci && npm ci\n')],
  'Quest version read by sed': ['names the', wrap("      - name: q\n        run: |\n          v=\"$(sed -n 's/.*Quest CLI \\([0-9.]*\\).*/\\1/p' CLAUDE.md)\"\n")],
  'Quest version read by grep (not sed)': ['reads CLAUDE.md without', wrap("      - name: q\n        run: v=\"$(grep -o '[0-9][0-9.]*' CLAUDE.md | head -1)\"\n")],
  'Quest version read by awk naming the phrase': ['names the', wrap("      - name: q\n        run: awk '/Quest CLI/ {print $4}' x\n")],
};
for (const [label, [needle, text]] of Object.entries(bad)) {
  const v = violations('fixture.yml', text);
  v.some((x) => x.includes(needle)) ? ok(`rejects: ${label}`) : no(`did NOT reject: ${label}`, JSON.stringify(v));
}
// And a matching good fixture passes, so the rejections are not blanket.
const good = wrap(CO + CHECK + '      - name: i\n        env:\n          V: ${{ steps.q.outputs.version }}\n        run: npm install -g --ignore-scripts "x@$V"\n      - name: q\n        run: v="$(bash scripts/ci/read-quest-version.sh CLAUDE.md)"\n');
violations('good.yml', good).length === 0 ? ok('accepts a compliant fixture') : no('rejected a compliant fixture', JSON.stringify(violations('good.yml', good)));
// A backslash-continued install WITH the flag on the continuation line passes: the
// join must not turn a compliant command into a violation.
const goodCont = wrap(CO + CHECK + '      - name: i\n        run: |\n          npm install \\\n            -g --ignore-scripts "x@1.2.3"\n');
violations('goodcont.yml', goodCont).length === 0 ? ok('accepts a compliant backslash-continued install') : no('rejected a compliant continued install', JSON.stringify(violations('goodcont.yml', goodCont)));

// The same widening must not turn compliant forms into violations: a flag before the
// subcommand with the guard present, an explicit =true, and a shell:-led step.
for (const [label, run] of [
  ['npm -g install with --ignore-scripts', 'npm -g install --ignore-scripts "x@1.2.3"'],
  ['--ignore-scripts=true', 'npm install -g --ignore-scripts=true "x@1.2.3"'],
  ['npm rebuild with --ignore-scripts', 'npm rebuild --ignore-scripts'],
  ['a non-install npm command', 'npm --version'],
  ['the flag followed by a trailing comment', 'npm ci --ignore-scripts # why'],
  ['the flag on every command of a && chain', 'npm ci --ignore-scripts && npm rebuild --ignore-scripts'],
  ['npm audit with no fix', 'npm audit'],
  // nit 4: scripts of the root package are not dependency lifecycle scripts. `npm run ci`
  // is a script NAMED ci and is accepted; the decline is pinned by these cases.
  ['a quoted | and a hash then npm ci with the flag', 'x="|#" npm ci --ignore-scripts'],
  ['npm test with an unrelated substitution', 'npm test $(echo hi)'],
  ['a quoted flag with no stuck character', 'npm ci "--ignore-scripts"'],
  ['npm run build', 'npm run build'],
  ['npm run ci (a script named ci, not npm ci)', 'npm run ci'],
  ['npm test', 'npm test'],
  ['a subshell npm ci with the flag', '(cd sub && npm ci --ignore-scripts)'],
  ['npm update with the flag', 'npm update --ignore-scripts'],
  ['a path-prefixed npm with the flag', '/usr/bin/npm ci --ignore-scripts'],
  ['a quoted run value', '"npm ci --ignore-scripts"'],
  ['a quoted flag', 'npm ci "--ignore-scripts"'],
  ['a repeated --ignore-scripts and --ignore-scripts=true', 'npm install -g --ignore-scripts --ignore-scripts=true "x@1.2.3"'],
]) {
  const t = wrap(CO + CHECK + `      - shell: bash\n        run: ${run}\n`);
  violations('goodflag.yml', t).length === 0 ? ok(`accepts: ${label}`) : no(`rejected a compliant form: ${label}`, JSON.stringify(violations('goodflag.yml', t)));
}

// OMARK-106 LOW-4, accepting side: the layouts the reader was widened to understand must
// still pass when compliant, so the widening is not a blanket rejection.
for (const [label, t] of [
  ['two spaces after the dash', wrap(CO + CHECK + '      -  run: npm ci --ignore-scripts\n')],
  ['a quoted run key', wrap(CO + CHECK + '      - "run": npm ci --ignore-scripts\n')],
  ['an indentation indicator', wrap(CO + CHECK + '      - name: i\n        run: |2\n          npm ci --ignore-scripts\n')],
  ['a trailing comment after the block marker', wrap(CO + CHECK + '      - name: i\n        run: | # note\n          npm ci --ignore-scripts\n')],
]) {
  violations('goodlayout.yml', t).length === 0 ? ok(`accepts layout: ${label}`) : no(`rejected a compliant layout: ${label}`, JSON.stringify(violations('goodlayout.yml', t)));
}
// The file filter takes both extensions and nothing else.
['a.yml', 'a.yaml'].every(isWorkflowFile) && !['a.yml.bak', 'a.json', 'yaml'].some(isWorkflowFile)
  ? ok('the workflow file filter takes .yml and .yaml only') : no('the workflow file filter is wrong');

console.log(`\npassed ${pass}, failed ${fail}`);
if (pass < 107) { console.log('ran fewer than the 107 expected passing cases'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
