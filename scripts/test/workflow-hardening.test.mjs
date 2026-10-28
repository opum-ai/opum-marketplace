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
    const m = lines[i].match(/^(\s*)- (name|uses|run|id|if|env|with|shell|working-directory|timeout-minutes|continue-on-error)\b/);
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
    const m = L[k].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    const ind = m[1].length + (L[k].trimStart().startsWith('- ') ? 2 : 0);
    if (m[2] && !/^[|>][-+]?$/.test(m[2])) { out.push(m[2]); continue; }
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

// Any npm subcommand that can run a dependency lifecycle script, wherever its flags
// sit: `npm -g install` puts a flag BEFORE the subcommand, so the subcommand is
// looked for anywhere later in the same shell command (up to ; & | or a newline).
// rebuild and install-test/it/cit also execute scripts (OMARK-102 finding 3).
const NPM_CMD = /(^|[\s;&|(])(npm\b[^;&|\n]*?\s(install|i|add|ci|exec|x|rebuild|rb|install-test|it|install-ci-test|cit)\b|npx\b)/;

// --ignore-scripts must be present AND not switched back off: `--ignore-scripts=false`
// contains the word and means the opposite (OMARK-102 finding 2).
const hasIgnoreScripts = (ln) =>
  /(^|\s)--ignore-scripts(=true)?(?=\s|$|["'])/.test(ln) && !/--ignore-scripts=(false|0)\b|--no-ignore-scripts\b/.test(ln);

export function violations(file, text) {
  const v = [];
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
    for (const ln of run.split('\n')) {
      if (NPM_CMD.test(ln) && !hasIgnoreScripts(ln)) {
        v.push(`${file}:${s.line}: npm/npx command without --ignore-scripts: ${ln.trim()}`);
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
const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml')).sort();
let stepCount = 0, checkouts = 0, installs = 0, runBlocks = 0, readers = 0;
for (const f of files) {
  const text = readFileSync(path.join(wfDir, f), 'utf8');
  for (const s of steps(text)) {
    stepCount++;
    const rt = joinContinuations(runText(s));
    if (/uses:\s*actions\/checkout@/.test(s.lines.join('\n'))) checkouts++;
    if (rt) runBlocks++;
    if (NPM_CMD.test(rt)) installs++;
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
  '--no-ignore-scripts': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --no-ignore-scripts "x@1.2.3"\n')],
  'a flag placed before the subcommand (npm -g install)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm -g install "x@1.2.3"\n')],
  'npm rebuild': ['without --ignore-scripts', wrap('      - name: i\n        run: npm rebuild\n')],
  'npm install-test': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install-test\n')],
  'a step opening with shell: (npm ci inside it)': ['without --ignore-scripts', wrap('      - shell: bash\n        run: npm ci\n')],
  'a step opening with working-directory: (npm ci inside it)': ['without --ignore-scripts', wrap('      - working-directory: sub\n        run: npm ci\n')],
  'a step opening with timeout-minutes: carrying a ${{ }} in run:': ['interpolated inside run', wrap('      - timeout-minutes: 5\n        run: echo "${{ github.base_ref }}"\n')],
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
]) {
  const t = wrap(CO + CHECK + `      - shell: bash\n        run: ${run}\n`);
  violations('goodflag.yml', t).length === 0 ? ok(`accepts: ${label}`) : no(`rejected a compliant form: ${label}`, JSON.stringify(violations('goodflag.yml', t)));
}

console.log(`\npassed ${pass}, failed ${fail}`);
if (pass < 34) { console.log('ran fewer than the 34 expected passing cases'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
