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
    const m = lines[i].match(/^(\s*)- (name|uses|run|id|if|env|with)\b/);
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

export function violations(file, text) {
  const v = [];
  for (const s of steps(text)) {
    const body = s.lines.join('\n');
    const run = runText(s);
    // Item 2: every checkout opts out of persisting the token.
    if (/uses:\s*actions\/checkout@/.test(body) && !/persist-credentials:\s*false\b/.test(body)) {
      v.push(`${file}:${s.line}: actions/checkout does not set persist-credentials: false`);
    }
    // Item 4: nothing is interpolated into a shell body.
    if (run.includes('${{')) {
      v.push(`${file}:${s.line}: a \${{ }} expression is interpolated inside run: (pass it through env:)`);
    }
    // Item 1: a global npm install must not run dependency lifecycle scripts.
    for (const ln of run.split('\n')) {
      if (/\bnpm\s+(install|i|add)\b/.test(ln) && /(^|\s)-g\b|--global\b/.test(ln) && !/--ignore-scripts\b/.test(ln)) {
        v.push(`${file}:${s.line}: npm global install without --ignore-scripts: ${ln.trim()}`);
      }
    }
    // Item 3: the Quest version is read by the one bounded script, not by sed.
    if (/Quest CLI/.test(run) && /\bsed\b/.test(run)) {
      v.push(`${file}:${s.line}: Quest version read by sed; use scripts/ci/read-quest-version.sh`);
    }
  }
  return v;
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const no = (m, d) => { fail++; console.log(`  FAIL ${m}`); if (d) console.log(`       | ${d}`); };

// --- the real workflows are clean, and we really read them ----------------
const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml')).sort();
let stepCount = 0, checkouts = 0, installs = 0, runBlocks = 0;
for (const f of files) {
  const text = readFileSync(path.join(wfDir, f), 'utf8');
  for (const s of steps(text)) {
    stepCount++;
    if (/uses:\s*actions\/checkout@/.test(s.lines.join('\n'))) checkouts++;
    if (runText(s)) runBlocks++;
    if (/npm\s+install\b.*-g/.test(runText(s))) installs++;
  }
  const v = violations(f, text);
  v.length === 0 ? ok(`${f}: no hardening violations`) : v.forEach((x) => no(x));
}
// Positive control: a reader that found nothing would also report no violations.
stepCount >= 20 ? ok(`read ${stepCount} steps across ${files.length} workflows`) : no(`read only ${stepCount} steps; the reader is not seeing the workflows`);
checkouts === 4 ? ok('found all 4 actions/checkout steps') : no(`expected 4 checkout steps, found ${checkouts}`);
installs === 2 ? ok('found both global npm install steps') : no(`expected 2 global npm installs, found ${installs}`);
runBlocks >= 10 ? ok(`read ${runBlocks} run: bodies`) : no(`read only ${runBlocks} run: bodies`);

// --- each rule rejects its own bad fixture --------------------------------
const bad = {
  'checkout without persist-credentials: false': ['persist-credentials', `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n`],
  'a ${{ }} inside run:': ['interpolated inside run', `jobs:\n  a:\n    steps:\n      - name: x\n        run: |\n          echo "\${{ github.base_ref }}"\n`],
  'a single-line run: with ${{ }}': ['interpolated inside run', `jobs:\n  a:\n    steps:\n      - run: npm install -g --ignore-scripts "x@\${{ steps.q.outputs.version }}"\n`],
  'npm install -g without --ignore-scripts': ['without --ignore-scripts', `jobs:\n  a:\n    steps:\n      - name: i\n        env:\n          V: 1\n        run: npm install -g "@opum-ai/quest@$V"\n`],
  'Quest version read by sed': ['read by sed', `jobs:\n  a:\n    steps:\n      - name: q\n        run: |\n          v="$(sed -n 's/.*Quest CLI \\([0-9.]*\\).*/\\1/p' CLAUDE.md)"\n`],
};
for (const [label, [needle, text]] of Object.entries(bad)) {
  const v = violations('fixture.yml', text);
  v.some((x) => x.includes(needle)) ? ok(`rejects: ${label}`) : no(`did NOT reject: ${label}`, JSON.stringify(v));
}
// And the matching good fixture passes, so the rejections are not blanket.
const good = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - name: i\n        env:\n          V: \${{ steps.q.outputs.version }}\n        run: npm install -g --ignore-scripts "x@$V"\n`;
violations('good.yml', good).length === 0 ? ok('accepts a compliant fixture') : no('rejected a compliant fixture', JSON.stringify(violations('good.yml', good)));

console.log(`\npassed ${pass}, failed ${fail}`);
if (pass < 12) { console.log('ran fewer than the 12 expected passing cases'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
