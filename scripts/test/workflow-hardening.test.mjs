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
  const keyCol = L[0].match(/^\s*-\s+/)?.[0].length ?? 0;
  for (let k = 0; k < L.length; k++) {
    // Dev's match, unchanged: an unquoted `run:` at any depth, with a one-space dash.
    let m = L[k].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    let ind;
    if (m) {
      ind = m[1].length + (L[k].trimStart().startsWith('- ') ? 2 : 0);
      m = [m[0], m[1], null, m[2]];
    } else {
      // OMARK-106 LOW-4: a quoted key, a spaced colon or a multi-space dash are accepted ONLY
      // on the step's own dash line or at the step's key column. Anywhere else (an env var
      // or with-input named "run") they are not the step's run text (round-4 blocker).
      m = L[k].match(/^(\s*)(-\s+)?["']?run["']?\s*:\s*(.*)$/);
      if (!m) continue;
      if (k !== 0 && !(indentOf(L[k]) === keyCol && !m[2])) continue;
      ind = m[1].length + (m[2] ? m[2].length : 0);
    }
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

// The npm subcommands LISTED in the alternation below (install, i, add, ci, exec, x,
// rebuild, rb, install-test, it, install-ci-test, cit), plus npx, wherever the flags
// sit: `npm -g install` puts a flag BEFORE the subcommand, so the subcommand is
// looked for anywhere later in the same shell command (up to ; & | or a newline).
// This is NOT every npm subcommand that can run a lifecycle script, and it does not
// try to be: update, dedupe, link, init and others are not listed (OMARK-102 finding 3).
// OMARK-106 ruling (opum-doc, option A): LOW-2 and LOW-3 (more subcommands, per-command and
// comment-stripped scanning) are NOT done here. Three review rounds showed that a line
// scanner trades one evasion for another; they are superseded by OMARK-109, a job-level
// npm_config_ignore_scripts that closes the class. This rule is the dev rule, unchanged,
// and stays as the backstop.
const NPM_CMD = /(^|[\s;&|(])(npm\b[^;&|\n]*?\s(install|i|add|ci|exec|x|rebuild|rb|install-test|it|install-ci-test|cit)\b|npx\b)/;

// --ignore-scripts must be present AND not switched back off: `--ignore-scripts=false`
// contains the word and means the opposite (OMARK-102 finding 2).
// A DENYLIST of off-values (=false, =0) is evadable (=00, =null, an empty =), so this
// is an allowlist over EVERY occurrence in the command: each must be exactly the bare
// flag or =true, and at least one must exist (review LOW-1).
// OMARK-106: an occurrence is the whole whitespace-delimited token, so a prefix stuck to the
// flag (`''--ignore-scripts=false`, `\\--ignore-scripts=false`) is not the bare flag and is
// refused; and a bare flag followed by a boolean-looking word (`--ignore-scripts false`) is
// refused too, because npm's option parser reads that next word as the flag's value.
const flagOccurrences = (cmd) => [...cmd.matchAll(/\S*--(?:no-)?ignore-scripts\S*/g)];
// OMARK-111 item 3: used on EVERY run line, not only npm lines, so an override flag on a
// subcommand NPM_CMD does not list (`npm update --no-ignore-scripts`) is still seen.
const hasBadIgnoreFlag = (cmd) => flagOccurrences(cmd).length > 0 && !hasIgnoreScripts(cmd);
const hasIgnoreScripts = (cmd) => {
  const occ = flagOccurrences(cmd);
  if (occ.length === 0) return false;
  return occ.every((m) => {
    const t = m[0];
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

// OMARK-111 (DEC-277 (a1), opum-doc, supersedes OMARK-109's job-level rule). The lint above is a
// line scanner and every review round found another evasion of it, so the control is the
// environment, set ONCE per workflow: `npm_config_ignore_scripts: "true"` in the WORKFLOW-level
// `env:`. Every job and step inherits it, so the protection does not depend on recognising npm
// at all (a new job running `npm update`, `/usr/bin/npm link` or a script that calls npm is
// covered). Two checks keep it from being dropped or switched off:
//   (a) every workflow file has the top-level env entry, exactly "true";
//   (b) no job-level or step-level env sets it to anything else.
// The one exception is an explicit opt-out for a job that genuinely needs lifecycle scripts: an
// override is accepted only with `# ignore-scripts-opt-out: <reason>` on the line directly above
// it, and every accepted opt-out is listed in the suite's output (workflowOptOuts).
// The command-recognition rule above stays as a backstop. A command-line flag (--no-ignore-scripts,
// --ignore-scripts=false) outranks the environment: that backstop catches it only for the
// subcommands NPM_CMD lists, plus the whole-run-text scan for any override flag or variable below.
const IGNORE_ENV = /^\s*["']?npm_config_ignore[-_]scripts["']?\s*:\s*(.*?)\s*(?:#.*)?$/i;
const isTrue = (v) => /^(["']?)true\1$/.test(v);
const OPT_OUT_MARK = /#\s*ignore-scripts-opt-out:\s*\S/;

// Jobs: each `  name:` key (optionally quoted, optionally with a trailing comment) under
// `jobs:`, up to the next job key or the next top-level key. A column-0 comment does not end a
// job (OMARK-111 items 6-8).
function jobBlocks(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (at < 0) return [];
  const isJob = (l) => /^  ["']?[\w-]+["']?:\s*(#.*)?$/.test(l);
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !lines[i].startsWith('#')) break;
    if (!isJob(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !isJob(lines[j]) && (!/^\S/.test(lines[j]) || lines[j].startsWith('#'))) j++;
    out.push({ name: lines[i].match(/^  ["']?([\w-]+)/)[1], line: i + 1, lines: lines.slice(i, j) });
  }
  return out;
}

// The top-level `env:` block: its entry lines, read at the block's own child indent so a
// block-scalar value that merely CONTAINS the text does not count (OMARK-111 item 10).
function topEnv(lines) {
  const at = lines.findIndex((l) => /^env:\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  let child = null, end = at + 1;
  for (; end < lines.length; end++) {
    const l = lines[end];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    if (indentOf(l) === 0) break;
    if (child === null) child = indentOf(l);
  }
  const entries = [];
  for (let k = at + 1; k < end; k++) {
    if (child !== null && indentOf(lines[k]) === child) { const m = lines[k].match(IGNORE_ENV); if (m) entries.push({ line: k + 1, value: m[1] }); }
  }
  return { at, end, entries };
}

// Every override of the variable below the workflow level: a value other than true, in any job
// or step env. Returns [{ line, job, value, reason }]; reason is null when the opt-out comment
// is absent.
export function workflowOverrides(text) {
  const lines = text.split('\n');
  const top = topEnv(lines);
  const jobs = jobBlocks(text);
  const out = [];
  lines.forEach((ln, k) => {
    if (top && k >= top.at && k < top.end) return;
    const m = ln.match(IGNORE_ENV);
    if (!m || isTrue(m[1])) return;
    const job = jobs.find((j) => k + 1 >= j.line && k + 1 < j.line + j.lines.length);
    const above = lines[k - 1] ?? '';
    out.push({ line: k + 1, job: job ? job.name : '(outside any job)', value: m[1], reason: OPT_OUT_MARK.test(above) ? above.trim() : null });
  });
  return out;
}
export const workflowOptOuts = (file, text) => workflowOverrides(text).filter((o) => o.reason).map((o) => `${file}:${o.line}: job ${o.job}: ${o.reason}`);

export function workflowEnvViolations(file, text) {
  const v = [];
  const lines = text.split('\n');
  const top = topEnv(lines);
  if (!top || !top.entries.some((e) => isTrue(e.value))) {
    v.push(`${file}: no workflow-level env: npm_config_ignore_scripts: "true" (DEC-277 a1: every workflow sets it once, at the top level)`);
  }
  for (const e of top ? top.entries : []) {
    if (!isTrue(e.value)) v.push(`${file}:${e.line}: the workflow-level npm_config_ignore_scripts is ${e.value || 'empty'}, not exactly "true"`);
  }
  for (const o of workflowOverrides(text)) {
    if (!o.reason) v.push(`${file}:${o.line}: job ${o.job} overrides npm_config_ignore_scripts to ${o.value || 'an empty value'} without an '# ignore-scripts-opt-out: <reason>' comment on the line directly above`);
  }
  if (jobBlocks(text).length === 0) v.push(`${file}: no jobs were read (a jobs: key with a comment or a non-2-space job indent is not understood), so no job could be checked`);
  lines.forEach((l, i) => {
    if (/^\s*env:\s*\{/.test(l)) v.push(`${file}:${i + 1}: flow-style env is not read by this checker; write block style`);
    // An anchor or alias could re-point an env value past the line reader (OMARK-111 item 9).
    if (!/^\s*#/.test(l) && (/^\s*<<:/.test(l) || /:\s+[&*][\w-]+\s*(#.*)?$/.test(l) || /^\s*-\s+[&*][\w-]+\s*(#.*)?$/.test(l))) {
      v.push(`${file}:${i + 1}: a YAML anchor or alias (&x, *x, <<:) is not read by this checker; write the value out`);
    }
  });
  return v;
}

export function violations(file, text) {
  const v = [];
  v.push(...workflowEnvViolations(file, text));
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
    for (const ln of run.split('\n')) {
      if (NPM_CMD.test(ln) && !hasIgnoreScripts(ln)) {
        v.push(`${file}:${s.line}: npm/npx command without --ignore-scripts: ${ln.trim()}`);
      }
    }
    // OMARK-111 item 3: the whole run text. Any override flag anywhere, and any touch of the
    // variable that is not a plain =true assignment (inline env, export, unset, env -u, a write
    // to $GITHUB_ENV), turns scripts back on past the workflow-level setting.
    for (const ln of run.split('\n')) {
      if (hasBadIgnoreFlag(ln)) v.push(`${file}:${s.line}: ignore-scripts override flag in a run: line: ${ln.trim()}`);
      for (const m of ln.matchAll(/\S*npm_config_ignore[-_]scripts\S*/gi)) {
        if (!/^npm_config_ignore_scripts=["']?true["']?$/.test(m[0])) {
          v.push(`${file}:${s.line}: a run: line touches npm_config_ignore_scripts (${m[0]}); only a plain =true assignment is allowed`);
        }
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
let jobsRead = 0, topEnvs = 0, optOutsListed = 0;
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
  jobsRead += jobBlocks(text).length;
  if (topEnv(text.split('\n'))?.entries.some((e) => isTrue(e.value))) topEnvs++;
  for (const line of workflowOptOuts(f, text)) { optOutsListed++; console.log(`  note opt-out: ${line}`); }
  const v = violations(f, text);
  v.length === 0 ? ok(`${f}: no hardening violations`) : v.forEach((x) => no(x));
}
// Positive control: a reader that found nothing would also report no violations.
jobsRead >= 5 ? ok(`read ${jobsRead} jobs`) : no(`read only ${jobsRead} jobs`);
// DEC-277 (a1): every workflow carries the top-level variable, and none opts out today.
topEnvs === files.length ? ok(`all ${files.length} workflows set the workflow-level variable to "true"`) : no(`only ${topEnvs} of ${files.length} workflows set the workflow-level variable`);
optOutsListed === 0 ? ok('no job opts out of the variable (listed above if any)') : no(`${optOutsListed} opt-out(s) listed above; confirm each is intended`);
stepCount >= 25 ? ok(`read ${stepCount} steps across ${files.length} workflows`) : no(`read only ${stepCount} steps; the reader is not seeing the workflows`);
checkouts === 4 ? ok('found all 4 actions/checkout steps') : no(`expected 4 checkout steps, found ${checkouts}`);
installs === 2 ? ok('found both npm install steps') : no(`expected 2 npm install steps, found ${installs}`);
readers === 2 ? ok('both Quest-version steps go through read-quest-version.sh') : no(`expected 2 steps using read-quest-version.sh, found ${readers}`);
runBlocks >= 10 ? ok(`read ${runBlocks} run: bodies`) : no(`read only ${runBlocks} run: bodies`);

// --- each rule rejects its own bad fixture --------------------------------
const CHECK = '      - name: c\n        run: bash scripts/ci/assert-no-persisted-credential.sh\n';
const CO = '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n';
// OMARK-109: every fixture job carries the job-level variable, so the older cases keep
// testing the rule they were written for and not the job rule.
const wrap = (steps) => `env:\n  npm_config_ignore_scripts: "true"\njobs:\n  a:\n    steps:\n${steps}`;
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
  'a bare flag with a stuck ; (rejected as a non-bare token, not as a second command)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci --ignore-scripts; npm install x\n')],
  'LOW-3: the flag only in a whole-line comment in a block': ['without --ignore-scripts', wrap('      - name: i\n        run: |\n          # --ignore-scripts\n          npm ci\n')],
  'LOW-4: two spaces after the step dash': ['without --ignore-scripts', wrap('      -  run: npm ci\n')],
  'LOW-4: a quoted run key': ['without --ignore-scripts', wrap('      - "run": npm ci\n')],
  'LOW-4: a flow-style step': ['flow-style YAML', wrap('      - { run: npm ci }\n')],
  'LOW-4: a flow-style steps list': ['flow-style YAML', 'jobs:\n  a:\n    steps: [ { run: npm ci } ]\n'],
  'LOW-4: a block scalar with an indentation indicator': ['without --ignore-scripts', wrap('      - name: i\n        run: |2\n          npm ci\n')],
  'LOW-4: a block scalar with a trailing comment after the marker': ['without --ignore-scripts', wrap('      - name: i\n        run: | # note\n          npm ci\n')],
  'LOW-4: a block scalar with chomping and a comment (>-)': ['without --ignore-scripts', wrap('      - name: i\n        run: >- # note\n          npm ci\n')],
  'npm ins x (rejected only through the trailing x exec alias, not through ins)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ins x\n')],
  'npm init x (rejected only through the trailing x exec alias)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm init x\n')],
  'npm create x (rejected only through the trailing x exec alias)': ['without --ignore-scripts', wrap('      - name: i\n        run: npm create x\n')],
  'R2-3: a bare --ignore-scripts then the word false': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts false "x"\n')],
  'R2-4: a bare flag, then empty quotes stuck to a false one': ['without --ignore-scripts', wrap("      - name: i\n        run: npm install -g --ignore-scripts ''--ignore-scripts=false x\n")],
  'R2-4: a bare flag, then a backslash stuck to a false one': ['without --ignore-scripts', wrap('      - name: i\n        run: npm install -g --ignore-scripts \\--ignore-scripts=false x\n')],
  // Review B1 / B2: each form must fail, and each was confirmed to pass unflagged on 8bf321d.
  'B1: a quoted space-hash hiding npm ci after &&': ['without --ignore-scripts', wrap('      - name: i\n        run: echo " #" && npm ci\n')],
  'B1: a quoted space-hash in an env assignment before npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: FOO=" #" npm ci\n')],
  'B1: a quoted space-hash then npm install after ;': ['without --ignore-scripts', wrap('      - name: i\n        run: echo "step #1"; npm install x\n')],
  'B2: npm ci inside a subshell': ['without --ignore-scripts', wrap('      - name: i\n        run: (cd sub && npm ci)\n')],
  'B2: npm ci inside $( )': ['without --ignore-scripts', wrap('      - name: i\n        run: x=$(npm ci)\n')],
  'B2: npm ci with a redirect stuck on': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci>/dev/null\n')],
  'B2: $(which npm) ci': ['without --ignore-scripts', wrap('      - name: i\n        run: $(which npm) ci\n')],
  // Cases kept from the #243 review rounds: each is rejected by dev's line rule plus the
  // --ignore-scripts value checks, which is all that is claimed here.
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
  // Round-4 blocker: a quoted/spaced `run` key under env: or with: is NOT the step's run text.
  // Dev rejects each of these; each was confirmed accepted on 25d16b2.
  'R4-a: a quoted "run" env key naming the credential script, the real run is echo': ['does not run scripts/ci/assert-no-persisted-credential.sh', wrap(CO + '      - name: c\n        env:\n          "run": bash scripts/ci/assert-no-persisted-credential.sh\n        run: echo hi\n')],
  'R4-b: a quoted "run" env key naming the version reader, the real run cats CLAUDE.md': ['reads CLAUDE.md without', wrap('      - name: q\n        env:\n          "run": scripts/ci/read-quest-version.sh\n        run: cat CLAUDE.md\n')],
  'R4-c: a quoted "run" env value completing a continued npm ci': ['without --ignore-scripts', wrap('      - name: i\n        run: npm ci \\\n        env:\n          "run": --ignore-scripts\n')],
  'Quest version read by sed': ['names the', wrap("      - name: q\n        run: |\n          v=\"$(sed -n 's/.*Quest CLI \\([0-9.]*\\).*/\\1/p' CLAUDE.md)\"\n")],
  'Quest version read by grep (not sed)': ['reads CLAUDE.md without', wrap("      - name: q\n        run: v=\"$(grep -o '[0-9][0-9.]*' CLAUDE.md | head -1)\"\n")],
  'Quest version read by awk naming the phrase': ['names the', wrap("      - name: q\n        run: awk '/Quest CLI/ {print $4}' x\n")],
};
for (const [label, [needle, text]] of Object.entries(bad)) {
  const v = violations('fixture.yml', text);
  v.some((x) => x.includes(needle)) ? ok(`rejects: ${label}`) : no(`did NOT reject: ${label}`, JSON.stringify(v));
}
// --- OMARK-111 / DEC-277 (a1): the workflow-level variable ---------------------
const WENV = 'env:\n  npm_config_ignore_scripts: "true"\n';
const JOB = (extra, steps2, name = 'a') => `  ${name}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps2}`;
const wf = (top, jobs) => `${top}jobs:\n${jobs}`;
const NPMSTEP = '      - name: i\n        run: npm install -g --ignore-scripts x\n';
const OPTC = '# ignore-scripts-opt-out: this job exercises a dependency postinstall on purpose\n';
const ENVSTEP = (val, above = '') => `      - name: i\n        env:\n${above}          npm_config_ignore_scripts: ${val}\n        run: npm ci --ignore-scripts\n`;
const wbad = {
  'no workflow-level env at all': ['no workflow-level env', wf('', JOB('', NPMSTEP))],
  'a workflow-level env set to "false"': ['not exactly "true"', wf('env:\n  npm_config_ignore_scripts: "false"\n', JOB('', NPMSTEP))],
  'the key only inside a block-scalar value (item 10)': ['no workflow-level env', wf('env:\n  X: |\n    npm_config_ignore_scripts: "true"\n', JOB('', NPMSTEP))],
  'the key only at job level (not the workflow)': ['no workflow-level env', wf('', JOB('    env:\n      npm_config_ignore_scripts: "true"\n', NPMSTEP))],
  'a job override to "false" with no comment': ['without an', wf(WENV, JOB('    env:\n      npm_config_ignore_scripts: "false"\n', NPMSTEP))],
  'a step override to false with no comment': ['without an', wf(WENV, JOB('', ENVSTEP('false')))],
  'an override with a comment two lines above, not adjacent': ['without an', wf(WENV, JOB('', ENVSTEP('false', '          ' + OPTC + '          # unrelated\n')))],
  'the opt-out comment with an empty reason': ['without an', wf(WENV, JOB('', ENVSTEP('false', '          # ignore-scripts-opt-out:\n')))],
  'the hyphen spelling set to "0"': ['without an', wf(WENV, JOB('', ENVSTEP('"0"').replace('npm_config_ignore_scripts', 'npm_config_ignore-scripts')))],
  'an empty override value': ['without an', wf(WENV, JOB('', ENVSTEP('')))],
  'a flow-style env mapping': ['flow-style env', wf(WENV, JOB('    env: { npm_config_ignore_scripts: "false" }\n', NPMSTEP))],
  'an override in a quoted-key job (item 6)': ['without an', wf(WENV, JOB('', NPMSTEP) + '  "b":\n    runs-on: x\n    env:\n      npm_config_ignore_scripts: "false"\n    steps:\n      - run: echo\n')],
  'an override in a job whose key has a trailing comment (item 6)': ['without an', wf(WENV, JOB('', NPMSTEP) + '  b: # note\n    runs-on: x\n    env:\n      npm_config_ignore_scripts: "false"\n    steps:\n      - run: echo\n')],
  'an override after a column-0 comment inside a job (item 7)': ['without an', wf(WENV, JOB('', NPMSTEP) + '# column-zero comment\n' + JOB('    env:\n      npm_config_ignore_scripts: "false"\n', NPMSTEP, 'b'))],
  'jobs: with a trailing comment and 4-space jobs read as no jobs (item 8)': ['no jobs were read', WENV + 'jobs: # x\n    a:\n      steps:\n        - run: echo\n'],
  'a YAML alias used as an env value (item 9)': ['anchor or alias', wf(WENV, JOB('', '      - name: i\n        env: *off\n        run: echo\n'))],
  'a YAML merge key (item 9)': ['anchor or alias', wf(WENV, JOB('    env:\n      <<: *off\n', NPMSTEP))],
  // item 3: the whole run text
  'inline npm_config_ignore_scripts=false before npm update': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: npm_config_ignore_scripts=false npm update\n'))],
  'export npm_config_ignore_scripts=false': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: export npm_config_ignore_scripts=false\n'))],
  'unset npm_config_ignore_scripts': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: unset npm_config_ignore_scripts\n'))],
  'env -u npm_config_ignore_scripts': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: env -u npm_config_ignore_scripts npm update\n'))],
  'a write to $GITHUB_ENV': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: echo npm_config_ignore_scripts=false >> $GITHUB_ENV\n'))],
  'npm update --no-ignore-scripts (a subcommand NPM_CMD does not list)': ['override flag', wf(WENV, JOB('', '      - run: npm update --no-ignore-scripts\n'))],
  'npm link --ignore-scripts=false': ['override flag', wf(WENV, JOB('', '      - run: npm link --ignore-scripts=false\n'))],
};
for (const [label, [needle, t]] of Object.entries(wbad)) {
  const r = violations('fixture.yml', t);
  r.some((x) => x.includes(needle)) ? ok(`workflow-env rule rejects: ${label}`) : no(`workflow-env rule did NOT reject: ${label}`, JSON.stringify(r));
}
// Accepting side: the rule is not a blanket, and inheritance covers a job the old detector
// could not see as an npm job.
for (const [label, t] of [
  ['a new job with no setup-node running npm update (covered by inheritance)', wf(WENV, JOB('', '      - run: npm update\n', 'new'))],
  ['a job that runs /usr/bin/npm link (covered by inheritance)', wf(WENV, JOB('', '      - run: /usr/bin/npm link\n', 'new'))],
  ['a script that calls npm (covered by inheritance)', wf(WENV, JOB('', '      - run: bash scripts/does-npm.sh\n', 'new'))],
  ['the variable true at job level too', wf(WENV, JOB('    env:\n      npm_config_ignore_scripts: true\n', NPMSTEP))],
  ['the variable true at step level too', wf(WENV, JOB('', ENVSTEP('"true"')))],
  ['an override with the adjacent opt-out comment', wf(WENV, JOB('', ENVSTEP('false', '          ' + OPTC)))],
  ['a plain =true assignment in a run line', wf(WENV, JOB('', '      - run: npm_config_ignore_scripts=true npm ci --ignore-scripts\n'))],
  ['a quoted job key with no override', wf(WENV, JOB('', NPMSTEP, '"quoted"'))],
  ['jobs: with a trailing comment and 2-space jobs', WENV + 'jobs: # x\n' + JOB('', NPMSTEP)],
]) {
  const r = violations('fixture.yml', t);
  r.length === 0 ? ok(`workflow-env rule accepts: ${label}`) : no(`workflow-env rule rejected: ${label}`, JSON.stringify(r));
}
// An accepted opt-out is LISTED, once, with its reason; a refused one is not.
{
  const okT = wf(WENV, JOB('', ENVSTEP('false', '          ' + OPTC)));
  const listed = workflowOptOuts('fixture.yml', okT);
  listed.length === 1 && listed[0].includes('exercises a dependency postinstall') ? ok('an accepted opt-out is listed with its reason') : no('the accepted opt-out was not listed', JSON.stringify(listed));
  workflowOptOuts('fixture.yml', wf(WENV, JOB('', ENVSTEP('false')))).length === 0 ? ok('a refused opt-out (no comment) is not listed as accepted') : no('a comment-less override was listed as an accepted opt-out');
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
  // Root-package scripts are not listed subcommands, so these are accepted.
  ['a quoted | and a hash then npm ci with the flag', 'x="|#" npm ci --ignore-scripts'],
  ['npm test with an unrelated substitution', 'npm test $(echo hi)'],
  ['a quoted flag with no stuck character', 'npm ci "--ignore-scripts"'],
  ['npm run build', 'npm run build'],
  ['npm test', 'npm test'],
  ['npm update with the flag', 'npm update --ignore-scripts'],
  ['a path-prefixed npm with the flag', '/usr/bin/npm ci --ignore-scripts'],
  ['a quoted run value', '"npm ci --ignore-scripts"'],
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
if (pass < 133) { console.log('ran fewer than the 133 expected passing cases'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
