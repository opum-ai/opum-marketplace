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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
// bash deletes a backslash-newline outright, so `--no-ignore-\` + `scripts` is ONE word. This regex
// also removes the next line's own indentation: over-joining, which only makes the scans stricter
// (bash would keep that whitespace as a word separator). OMARK-111 round 3 N3.
const joinContinuations = (t) => t.replace(/\\\n\s*/g, '');

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
// flag (`''--ignore-scripts=false`, `\\--ignore-scripts=false`) is refused (quotes and
// backslashes are deleted first, as bash does, so a stuck prefix on a bare flag is the bare flag); and a bare flag followed by a boolean-looking word (`--ignore-scripts false`) is
// refused too, because npm's option parser reads that next word as the flag's value.
// OMARK-111 B1 (rounds 1-3): npm's parser (nopt) strips ALL leading dashes, toggles on every
// case-insensitive `no-`, and expands abbreviations (npm 10 and 11 do, with a deprecation
// warning), so `--NO-ignore-scripts`, `--no-no-no-ignore-scripts`, `--ignore-script=false`,
// `--ignore-scrip=false` and `--no-ig` all reach the same option. And bash removes quotes and
// backslashes when it parses the line, so `--ignore-"scripts"=false` is `--ignore-scripts=false`.
// An occurrence is therefore any whitespace-delimited token that, once quotes and backslashes
// are deleted, is option-like (junk, then a dash; or `--` anywhere) and whose option name, with
// the dashes and any run of `no-` removed and cut at the first character that is not a letter,
// `-` or `_`, is a prefix of `ignore-scripts` of at least two characters (`ig`) or contains
// `ignore-script`. Only the exact bare flag and `--ignore-scripts=true` are allowed. NOT closable
// by a line scanner: a flag or name that ANY interpreter assembles (the shell with `$A$B` or `eval`,
// `node -e`, github-script `core.exportVariable('npm_config_ignore_' + 'scripts', ...)`), or one that
// lives in a file this reader never opens (a script, a local composite action).
const deq = (t) => t.replace(/['"\\]/g, '');
const IGNORE_NAME = 'ignore-scripts';
function optionName(raw) {
  const n = deq(raw);
  let core = null;
  if (/^[^\w\s-]*-/.test(n)) core = n.replace(/^[^\w\s-]*/, '');
  else { const i = n.indexOf('--'); if (i >= 0) core = n.slice(i); }
  if (core === null) return null;
  core = core.replace(/^-+/, '').replace(/^(?:no-)*/i, '');
  return core.match(/^[a-z_-]*/i)[0].toLowerCase().replace(/_/g, '-');
}
const isIgnoreName = (name) => name.length >= 2 && (IGNORE_NAME.startsWith(name) || name.includes('ignore-script'));
const flagOccurrences = (cmd) => [...cmd.matchAll(/\S+/g)].filter((m) => { const nm = optionName(m[0]); return nm !== null && isIgnoreName(nm); });
// OMARK-111 item 3: used on EVERY line of the file, not only npm lines, so an override flag on a
// subcommand NPM_CMD does not list (`npm update --no-ignore-scripts`) is still seen.
const hasBadIgnoreFlag = (cmd) => flagOccurrences(cmd).length > 0 && !hasIgnoreScripts(cmd);
// OMARK-111 item 7: npm 12's --dangerously-allow-all-scripts (and its npm_config_ form). Which of it
// and ignore-scripts wins on npm 12 is UNMEASURED; refused in workflows so it cannot be the bypass
// the day CI moves to npm 12. Only scripts/test/install-ignore-scripts.test.sh (not read here) uses it.
const ALLOW_ALL_NAME = 'dangerously-allow-all-scripts';
const hasAllowAllScripts = (cmd) => /dangerously[-_]allow[-_]all[-_]scripts/i.test(deq(cmd)) ||
  [...cmd.matchAll(/\S+/g)].some((m) => { const nm = optionName(m[0]); return nm !== null && nm.length >= 4 && ALLOW_ALL_NAME.startsWith(nm); });
const hasIgnoreScripts = (cmd) => {
  const occ = flagOccurrences(cmd);
  if (occ.length === 0) return false;
  return occ.every((m) => {
    const tok = deq(m[0]);
    if (tok === '--ignore-scripts=true') return true;
    if (tok !== '--ignore-scripts') return false;
    // The value word is read the way bash hands it to npm: quotes and backslashes deleted
    // (`"fa"lse`, `fals\e` are `false`), OMARK-111 round 3 B2.
    const nxt = cmd.slice(m.index + m[0].length).match(/^\s+(\S+)/);
    // A structural form in the value word (a `$'` or `$"` quote, or a brace group) is refused, after
    // `${...}` and `${{ }}` are stripped: `"x@${V}"` is the canonical safe argument.
    if (nxt && (/\$['"]/.test(nxt[1]) || /[{}]/.test(nxt[1].replace(/\$\{\{.*?\}\}/g, '').replace(/\$\{[^{}]*\}/g, '')))) return false;
    return !(nxt && /^(true|false|null|undefined|[0-9]+)(?:[)<>`;&|].*)?$/i.test(deq(nxt[1])));
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
// subcommands NPM_CMD lists. Further scans cover the rest, over every non-comment line of the file
// (logical lines, joined across a trailing backslash): an override flag in any spelling nopt reads
// (flagOccurrences), the variable's name outside the top-level env block (variableTouches), `env -i`,
// `env -` and BASH_ENV, and npm 12's allow-all-scripts flag. readabilityViolations refuses the YAML
// this reader cannot follow (the layout allowlist in the CONTRACT below) and the structural shell forms.
// STATED CLAIM (DEC-277 (a2), opum-doc, verbatim): "catches plain-text and accidental overrides of the
// workflow-level protection; not a defence against an adversarial workflow author".
// CONTRACT (DEC-277 (a2) Q2, A): YAML side, a strict layout allowlist, enforced in readabilityViolations:
// | bodies only; outside them every line is a key line, a `- ` item or a block header (so no plain
// scalar on its own line or continued on the next); no > folds (header anywhere, nested too); no
// backslash outside bodies; no multi-line quoted scalars; no anchors, aliases or tags (any non-space
// name, at any node position); no ? keys; no expression keys; env: only as a block mapping; no step or
// node `uses: ./...` (a job-level `uses: ./.github/workflows/x.yml` is read, so allowed). Shell side, only
// the structural forms: brace groups (comma or ..) and $' or $" quoting, refused at EVERY position of a
// non-comment line except ${...} and ${{ }}, because each round's gap was a classification step the
// evading form manipulated; plus the de-quoted value word after --ignore-scripts, refused when it holds
// a $' / $" / brace form. Cheap extras kept: env -i, env -, BASH_ENV, npm 12's allow-all flag.
// DEC-277 (a3) (opum-doc, ODOC-615) amends (a2) Q2's shell side: brace groups (comma or ..) and $' / $" are
// refused at EVERY position of every non-comment line, bodies and heredocs included. The breadth is
// deliberate and tested: grep '^x$', awk '{print $1, $2}', jq '{name, version}', a destructuring
// node -e body and `echo {a,b}` are all REFUSED, with a message that names the rule and its remedy (move
// the text into a script file the step runs, or restructure it). The `# ignore-scripts-opt-out:` comment
// does not extend to this rule.
// DECLINED BY NAME (a line scanner is the design; a parser is a dependency, DEC-182 (1)): all shell
// expansion and quoting deq does not model ($A$B, eval, indirect expansion, parameter expansion, command
// substitution); any interpreter assembling the name (node, python, perl, a script file called from
// run:); env-clearing commands (sudo, su -, exec -c, setpriv, docker run and exec, ssh); remote reusable
// workflows (jobs.x.uses: owner/repo/path@ref, which do not inherit the caller's env); local or
// third-party actions (never opened; the suite goes red if .github/actions appears, as a tripwire only).
// Which of --dangerously-allow-all-scripts and ignore-scripts wins on npm 12 is UNMEASURED, so the flag
// is refused outright in workflows.
const IGNORE_ENV = /^\s*["']?npm_config_ignore[-_]scripts["']?\s*:\s*(.*?)(?:\s+#.*)?\s*$/i;
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

// OMARK-111 B3: every non-comment line outside the top-level env block, wherever the variable
// is named: a run: body, `shell:`, `defaults.run.shell` (`env -u ...`), a github-script
// `core.exportVariable(...)`, a matrix list item. The one allowed spelling is a plain
// `npm_config_ignore_scripts=true` token; a `key: value` env entry at the start of a line is
// the opt-out rule's business (workflowOverrides), so it is skipped here.
export function variableTouches(text) {
  const lines = text.split('\n');
  const top = topEnv(lines);
  const out = [];
  for (const { k, text: ln } of logicalLines(text)) {
    if (top && k >= top.at && k < top.end) continue;
    if (/^\s*#/.test(ln) || IGNORE_ENV.test(ln)) continue;
    for (const m of ln.matchAll(/\S+/g)) {
      const tok = deq(m[0]);
      if (/npm_config_ignore[-_]script/i.test(tok) && tok !== 'npm_config_ignore_scripts=true') out.push({ line: k + 1, tok: m[0] });
    }
  }
  return out;
}

// Lines for the scans, `k` the 0-based first line: EVERY physical line, plus the logical line when
// a trailing backslash joins it to the next one (the way bash reads it), so a name or flag split over
// a continuation is one token. Both are scanned, so neither reading can hide a line from the other.
// A comment line is never extended (bash keeps a trailing backslash in a comment literal, so the
// next line still runs), and only an ODD run of trailing backslashes is a continuation (`a\\` is a
// literal backslash). OMARK-111 round 3 B1.
export function logicalLines(text) {
  const raw = text.split('\n');
  const out = raw.map((t, k) => ({ k, text: t }));
  for (let i = 0; i < raw.length; i++) {
    const cont = (t) => !/^\s*#/.test(t) && (t.match(/\\*$/)[0].length % 2 === 1);
    if (!cont(raw[i])) continue;
    let t = raw[i];
    const k = i;
    // The next line's indentation is dropped too: a block scalar's own indent is not part of the
    // text bash reads, and over-joining only makes the scans stricter.
    while (cont(t) && i + 1 < raw.length) t = t.slice(0, -1) + raw[++i].trimStart();
    out.push({ k, text: t });
  }
  return out;
}

// Line indexes inside a block-scalar body (`key: |`, `- >-`): shell text where backslashes and
// quotes are not YAML syntax. Everything else is YAML the line reader must understand.
// A block-scalar header: optional `- ` items (nested too), an optional key, then | or > with an
// optional chomping or indentation indicator. Group 1 indent, 2 the dashes, 3 the indicator.
const BLOCK_HEADER = /^(\s*)((?:-\s+)*)(?:["']?[\w.-]+["']?\s*:\s*)?([|>])[-+1-9]*\s*(?:#.*)?$/;
function blockBodyLines(lines) {
  const body = new Set();
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(BLOCK_HEADER);
    if (!h || /^\s*#/.test(lines[i])) continue;
    const hasKey = /:\s*[|>]/.test(lines[i]);
    const keyCol = h[1].length + (hasKey && h[2] ? h[2].length : 0);
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > keyCol); j++) body.add(j);
  }
  return body;
}

// OMARK-111 round 3, items 1-2, 6 and 7: forms of env: and of quoting this reader cannot follow,
// and commands that clear the environment or allow scripts without naming the variable.
export function readabilityViolations(file, text) {
  const v = [];
  const lines = text.split('\n');
  const body = blockBodyLines(lines);
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l) || body.has(i)) return;
    if (/^(?:---|\.\.\.)\s*(?:#.*)?$/.test(l)) return; // a YAML document start or end marker is legal and read as nothing
    // Item 2: YAML decodes \x69, i and an escaped line break inside a double-quoted scalar, in
    // a key as well as a value, so `"npm_config_ignore_scr\x69pts": "false"` is the variable by
    // another name. Refuse a double-quoted scalar with a backslash outside block-scalar bodies.
    // DEC-277 (a2) strict layout allowlist: ANY backslash outside a block-scalar body is refused (a
    // YAML escape in a double-quoted scalar, or a continuation this reader would read differently).
    if (/\\/.test(l)) v.push(`${file}:${i + 1}: a backslash escape outside a | block body is not read by this checker (YAML decodes it in a double-quoted scalar); write it without one`);
    // ...no > folds, no ? keys, no expression keys; anchors, aliases and tags are checked at node positions below.
    if (BLOCK_HEADER.exec(l)?.[3] === '>') v.push(`${file}:${i + 1}: a > folded block scalar is not read by this checker; use a | body or a single-line scalar`);
    if (/^\s*(?:-\s+)?\?(?:\s|$)/.test(l)) v.push(`${file}:${i + 1}: a ? explicit key is not read by this checker; write the key plainly`);
    const keyEnd = l.search(/:(\s|$)/);
    if (keyEnd >= 0 && l.slice(0, keyEnd).includes('${' + '{')) v.push(`${file}:${i + 1}: an expression key (an expression before the colon) is not read by this checker; the key's name never appears in the file`);
    // N2: a step or any other node that runs a local action reads files this checker never opens. The
    // one exception is a job-level `uses:` of a workflow file (read, because it lives in wfDir).
    if (/^\s*(?:-\s+)?["']?uses["']?\s*:\s*["']?\.\//.test(l) && !(/^ {4}uses/.test(l) && /uses["']?\s*:\s*["']?\.\/\.github\/workflows\/\S+\.ya?ml["']?\s*(?:#.*)?$/.test(l))) v.push(`${file}:${i + 1}: a local action (uses: ./...) is not read by this checker; its env: and run: are never opened`);
    {
      // Single-line scalars elsewhere: a quoted scalar must close on its own line, and a plain or
      // quoted scalar may not continue on a more-indented line below.
      const sm = l.match(/^(\s*)((?:-\s+)*)(.*)$/);
      const content = sm[3];
      const kv = content.match(/^(?:"[^"]*"|'[^']*'|[^\s"'#:][^#]*?)\s*:\s+(\S.*)$/);
      const value = (kv ? kv[1] : (/:\s*(?:#.*)?$/.test(content) || content === '' ? '' : content));
      // An anchor, alias or tag at a NODE position only: the start of the content (after any `- `
      // items; this is also the key node) or the start of the value after `key: `, chaining any `!tag`
      // or `&anchor` properties first. A `&&`, `!cancelled()` or `*.md` inside a value is not a node
      // start. Names are ANY non-space characters, not just [\w-].
      for (const node of kv ? [content, kv[1]] : [content]) {
        let n = node, sawTag = false, sawAnchor = false;
        for (;;) {
          const pm = n.match(/^([!&])\S*\s+/);
          if (!pm) break;
          if (pm[1] === '!') sawTag = true; else sawAnchor = true;
          n = n.slice(pm[0].length);
        }
        if (sawTag || /^!/.test(n)) v.push(`${file}:${i + 1}: a YAML tag (!x) at a node position is not read by this checker; write the value plainly`);
        if (sawAnchor || /^[&*]\S/.test(n)) v.push(`${file}:${i + 1}: a YAML anchor or alias (&x, *x) is not read by this checker; write the value out`);
      }
      // Outside | bodies every line is a key line, a `- ` item or a block header: anything else is the
      // start or the continuation of a plain scalar placed on its own line.
      if (sm[2] === '' && content !== '' && !kv && !/:\s*(?:#.*)?$/.test(content) && !BLOCK_HEADER.test(l)) {
        v.push(`${file}:${i + 1}: a line that is not a key line, a - item or a block header (a plain scalar on its own line) is not read by this checker`);
      }
      const vv = value.replace(/(^|\s)#.*$/, '').trim();
      if (vv !== '' && !/^[|>{[]/.test(vv)) {
        if ((vv.startsWith('"') && !/^"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(value.trim())) || (vv.startsWith("'") && !/^'(?:[^']|'')*'\s*(?:#.*)?$/.test(value.trim()))) {
          v.push(`${file}:${i + 1}: a multi-line quoted scalar is not read by this checker; keep a quoted scalar on one line`);
        }
        const keyCol = sm[1].length + (kv ? sm[2].length : 0);
        const nx = lines.slice(i + 1).find((x) => x.trim() !== '' && !/^\s*#/.test(x));
        if (nx !== undefined && indentOf(nx) > keyCol) v.push(`${file}:${i + 1}: a plain-scalar continuation (a more-indented line under a single-line value) is not read by this checker; keep the value on one line`);
      }
    }
    // Item 1: an env: whose value is not a block mapping. Optional `- ` (a step may open with env:),
    // optional quotes around the key.
    const em = l.match(/^(\s*)(-\s+)?["']?env["']?\s*:(.*)$/);
    if (!em) return;
    const val = em[3].replace(/(^|\s)#.*$/, '').trim();
    if (val.startsWith('{')) { v.push(`${file}:${i + 1}: flow-style env is not read by this checker; write block style`); return; }
    const refuse = `${file}:${i + 1}: expression-valued env: an env: whose value is not a block mapping (an expression, a quoted or plain scalar, a block scalar, or a value on the next line) is not read by this checker; write the keys out`;
    if (val !== '') { v.push(refuse); return; }
    const keyCol = em[1].length + (em[2] ? em[2].length : 0);
    const next = lines.slice(i + 1).findIndex((x) => x.trim() !== '' && !/^\s*#/.test(x));
    const nl = next < 0 ? '' : lines[i + 1 + next];
    if (!(nl && indentOf(nl) > keyCol && /^\s*(?!\$\{\{)["']?[^\s:#"']+["']?\s*:(\s|$)/.test(nl))) v.push(refuse);
  });
  for (const { k, text: ln } of logicalLines(text)) {
    if (/^\s*#/.test(ln)) continue;
    if (hasBadIgnoreFlag(ln)) v.push(`${file}:${k + 1}: ignore-scripts override flag on a line: ${ln.trim()}`);
    // Item 7 (npm 12): UNMEASURED which of this and ignore-scripts wins; refused until measured.
    if (hasAllowAllScripts(ln)) v.push(`${file}:${k + 1}: --dangerously-allow-all-scripts (or its npm_config_ form) allows all scripts and may outrank ignore-scripts on npm 12: ${ln.trim()}`);
    // Item 6: removing the environment without naming the variable.
    // DEC-277 (a2): the structural shell forms. Every round's gap was a classification step the evading
    // form could manipulate (which token is option-like, which names the variable), so these are refused
    // at EVERY position in any non-comment line, except `${...}` and `${{ }}`: a brace group with a comma
    // or `..`, and `$'` or `$"` quoting.
    {
      const bare = ln.replace(/\$\{\{.*?\}\}/g, '').replace(/\$\{[^{}]*\}/g, '');
      if (/\$['"]/.test(ln) || /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(bare)) v.push(`${file}:${k + 1}: structural shell form (a brace group with a comma or .., or $' or $" quoting) is refused at every position by DEC-277 (a3); move the text into a script file the step runs, or restructure it: ${ln.trim()}`);
    }
    if (/\bBASH_ENV\b/.test(deq(ln))) v.push(`${file}:${k + 1}: BASH_ENV names a file the shell runs first and could unset the variable`);
    const toks = deq(ln).split(/\s+/);
    toks.forEach((t, x) => {
      if (t !== 'env' && !t.endsWith('/env')) return;
      for (let y = x + 1; y < toks.length && toks[y].startsWith('-'); y++) {
        const o = toks[y];
        if (o === '-' || o === '--ignore-environment' || (/^-[A-Za-z0-9]+$/.test(o) && o.includes('i') && !/^-[uCS]/.test(o))) { v.push(`${file}:${k + 1}: env ${o} clears the environment, including npm_config_ignore_scripts: ${ln.trim()}`); break; }
        if (o === '-u' || o === '-C' || o === '-S') y++;
      }
    });
  }
  return v;
}

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
  for (const t of variableTouches(text)) {
    v.push(`${file}:${t.line}: a line touches npm_config_ignore_scripts (${t.tok}); only a plain =true assignment is allowed (job and step env: entries are judged by the opt-out rule instead)`);
  }
  if (jobBlocks(text).length === 0) v.push(`${file}: no jobs were read (a jobs: key that is not at column 0, or a job indent other than 2 spaces, is not understood), so no job could be checked`);
  lines.forEach((l, i) => {
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
  v.push(...readabilityViolations(file, text));
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
// DEC-277 (a2) Q1 (opum-doc ruling): a commented opt-out passes and is LISTED above, as (a1) point 3
// says; the second look is the DEC-183 review every workflow change gets. No zero-opt-out assertion.
ok(`${optOutsListed} opt-out(s) listed above`);
// OMARK-111 item 10: a local composite action's env: and run: live outside wfDir and are never read.
// A node `uses: ./...` (a job-level workflow file excepted) is refused above (readabilityViolations); this is a second tripwire for the
// conventional directory. Third-party actions can also core.exportVariable for later steps: a trust
// class this lint does not and cannot cover (DECLINED BY NAME).
!existsSync(path.join(wfDir, '..', 'actions')) ? ok('no local composite actions exist under .github/actions (their env: and run: would not be read)') : no('.github/actions exists: a local composite action is not read by this checker');
stepCount >= 25 ? ok(`read ${stepCount} steps across ${files.length} workflows`) : no(`read only ${stepCount} steps; the reader is not seeing the workflows`);
checkouts === 4 ? ok('found all 4 actions/checkout steps') : no(`expected 4 checkout steps, found ${checkouts}`);
installs === 2 ? ok('found both npm install steps') : no(`expected 2 npm install steps, found ${installs}`);
readers === 2 ? ok('both Quest-version steps go through read-quest-version.sh') : no(`expected 2 steps using read-quest-version.sh, found ${readers}`);
runBlocks >= 10 ? ok(`read ${runBlocks} run: bodies`) : no(`read only ${runBlocks} run: bodies`);

// --- each rule rejects its own bad fixture --------------------------------
const CHECK = '      - name: c\n        run: bash scripts/ci/assert-no-persisted-credential.sh\n';
const CO = '      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n';
// OMARK-111: every fixture carries the workflow-level variable, so the older cases keep
// testing the rule they were written for and not the workflow-env rule.
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
  'an override in a quoted-key job (item 6)': ['job b overrides', wf(WENV, JOB('', NPMSTEP) + '  "b":\n    runs-on: x\n    env:\n      npm_config_ignore_scripts: "false"\n    steps:\n      - run: echo\n')],
  'an override in a job whose key has a trailing comment (item 6)': ['job b overrides', wf(WENV, JOB('', NPMSTEP) + '  b: # note\n    runs-on: x\n    env:\n      npm_config_ignore_scripts: "false"\n    steps:\n      - run: echo\n')],
  // The column-0 comment sits INSIDE job b, above its env:, so the old reader ended b there and
  // attributed the override to no job. Items 6 and 7 change attribution only (the override line is
  // caught by the whole-file scan either way), so the needle names the job.
  'an override after a column-0 comment inside job b (item 7)': ['job b overrides', wf(WENV, JOB('', NPMSTEP) + '  b:\n    runs-on: x\n# column-zero comment\n    env:\n      npm_config_ignore_scripts: "false"\n    steps:\n      - run: echo\n')],
  'an override under a top-level key after jobs: is not a job (item 8)': ['job (outside any job) overrides', wf(WENV, JOB('', NPMSTEP)) + 'on:\n  push:\n    env:\n      npm_config_ignore_scripts: "false"\n'],
  'jobs: with a trailing comment and 4-space jobs read as no jobs (item 8)': ['no jobs were read', WENV + 'jobs: # x\n    a:\n      steps:\n        - run: echo\n'],
  'a YAML alias used as an env value (item 9)': ['anchor or alias', wf(WENV, JOB('', '      - name: i\n        env: *off\n        run: echo\n'))],
  'a YAML merge key (item 9)': ['anchor or alias', wf(WENV, JOB('    env:\n      <<: *off\n', NPMSTEP))],
  // OMARK-111 B1: the forms nopt reads as the same option
  'npm update --NO-ignore-scripts (case)': ['override flag', wf(WENV, JOB('', '      - run: npm update --NO-ignore-scripts\n'))],
  'npm update --No-ignore-scripts (mixed case)': ['override flag', wf(WENV, JOB('', '      - run: npm update --No-ignore-scripts\n'))],
  'npm update --no-no-no-ignore-scripts (repeated no-)': ['override flag', wf(WENV, JOB('', '      - run: npm update --no-no-no-ignore-scripts\n'))],
  'npm link --ignore-script=false (abbreviated name)': ['override flag', wf(WENV, JOB('', '      - run: npm link --ignore-script=false\n'))],
  'npm update -no-ignore-scripts (one dash)': ['override flag', wf(WENV, JOB('', '      - run: npm update -no-ignore-scripts\n'))],
  'REGRESSION GUARD, not a B1 discriminator (the old regex already caught it): npm update ---no-ignore-scripts (three dashes)': ['override flag', wf(WENV, JOB('', '      - run: npm update ---no-ignore-scripts\n'))],
  'npm update --ignore_scripts=false (underscore)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore_scripts=false\n'))],
  'npm install --ignore-scripts then --NO-ignore-scripts (the backstop hole: last flag wins)': ['without --ignore-scripts', wf(WENV, JOB('', '      - run: npm install --ignore-scripts --NO-ignore-scripts x\n'))],
  // OMARK-111 B2: an expression-valued env
  'env: ${{ matrix.e }} with a matrix item switching the variable off': ['expression-valued env', wf(WENV, JOB('    strategy:\n      matrix:\n        e:\n          - npm_config_ignore_scripts: "false"\n    env: ${{ matrix.e }}\n', NPMSTEP))],
  'env: ${{ fromJSON(...) }} at step level': ['expression-valued env', wf(WENV, JOB('', '      - name: i\n        env: ${{ fromJSON(\'{"npm_config_ignore_scripts":"false"}\') }}\n        run: echo\n'))],
  // OMARK-111 B3: the variable named outside any run: body
  'defaults.run.shell: env -u npm_config_ignore_scripts bash': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', NPMSTEP)).replace('jobs:\n', 'defaults:\n  run:\n    shell: env -u npm_config_ignore_scripts bash -e {0}\njobs:\n')],
  'a step shell: env -u npm_config_ignore_scripts bash': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - shell: env -u npm_config_ignore_scripts bash -e {0}\n        run: npm update\n'))],
  'github-script core.exportVariable of the variable': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', "      - uses: actions/github-script@v7\n        with:\n          script: core.exportVariable('npm_config_ignore_scripts','false')\n"))],
  'a matrix list item carrying the variable (no env: key above it)': ['touches npm_config_ignore_scripts', wf(WENV, JOB('    strategy:\n      matrix:\n        include:\n          - npm_config_ignore_scripts: "false"\n', NPMSTEP))],
  // OMARK-111 round 3 item 1 (B2): the env: layouts the first fix missed
  'a step opening with env: ${{ ... }} (item 1a)': ['expression-valued env', wf(WENV, JOB('', "      - env: ${{ fromJSON(vars.E) }}\n        run: echo\n"))],
  'a step opening with a flow-style env (item 1a)': ['flow-style env', wf(WENV, JOB('', '      - env: { npm_config_ignore_scripts: "false" }\n        run: echo\n'))],
  'a double-quoted expression env (item 1b)': ['expression-valued env', wf(WENV, JOB('    env: "${{ fromJSON(vars.E) }}"\n', NPMSTEP))],
  'a single-quoted expression env (item 1b)': ['expression-valued env', wf(WENV, JOB("    env: '${{ fromJSON(vars.E) }}'\n", NPMSTEP))],
  'an expression on the line after env: (item 1c)': ['expression-valued env', wf(WENV, JOB('    env:\n      ${{ fromJSON(vars.E) }}\n', NPMSTEP))],
  'env: as a folded block scalar holding an expression (item 1c)': ['expression-valued env', wf(WENV, JOB('    env: >-\n      ${{ fromJSON(vars.E) }}\n', NPMSTEP))],
  // item 2: YAML escapes
  'an escaped key under env (item 2)': ['backslash escape', wf(WENV, JOB('    env:\n      "npm_config_ignore_scr\\x69pts": "false"\n', NPMSTEP))],
  'an escaped value split over a line break (item 2)': ['backslash escape', wf(WENV, JOB('    env:\n      npm_config_ignore_scripts: "fal\\\n        se"\n', NPMSTEP))],
  'a double-quoted one-line run with an escaped flag (item 2)': ['backslash escape', wf(WENV, JOB('', '      - run: "npm update --no-ignore\\x2dscripts"\n'))],
  // item 3: a shell line shaped like an env entry, with a stuck #
  'a run line `npm_config_ignore_scripts: "true"#|| export ...` (item 3)': ['overrides', wf(WENV, JOB('', '      - run: |\n          npm_config_ignore_scripts: "true"#|| export npm_config_ignore_scripts=false\n          npm update\n'))],
  // item 4a: abbreviations
  'npm update --ignore-scrip=false (abbreviation)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore-scrip=false\n'))],
  'npm update --NO-ignore-scr (abbreviation, no value)': ['override flag', wf(WENV, JOB('', '      - run: npm update --NO-ignore-scr\n'))],
  'npm update --no-ig (shortest abbreviation)': ['override flag', wf(WENV, JOB('', '      - run: npm update --no-ig\n'))],
  'npm update --ignore=false (pure abbreviation)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore=false\n'))],
  // item 4b: quotes and backslashes inside a token
  'npm update --ignore-"scripts"=false': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore-"scripts"=false\n'))],
  "npm update --ig''nore-scripts=false": ['override flag', wf(WENV, JOB('', "      - run: npm update --ig''nore-scripts=false\n"))],
  'npm update --ignore\\-scripts=false': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore\\-scripts=false\n'))],
  'export npm_config_ignore_"scripts"=false': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: export npm_config_ignore_"scripts"=false\n'))],
  'env npm_config_ignore_"scripts"=false npm update': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: env npm_config_ignore_"scripts"=false npm update\n'))],
  // item 4c: a flag on a line the run-text reader never saw
  'a flag on the next line of a multi-line plain run scalar (item 4c)': ['override flag', wf(WENV, JOB('', '      - run: npm update\n          --no-ignore-scripts\n'))],
  'a flag held in an env value and used as $F (item 4c)': ['override flag', wf(WENV, JOB('', '      - name: i\n        env:\n          F: --no-ignore-scripts\n        run: npm update $F\n'))],
  // item 4d: a flag split by a backslash-newline with no space
  'a flag split by a backslash-newline inside the no- prefix, so neither half is a name prefix (item 4d)': ['override flag', wf(WENV, JOB('', '      - run: |\n          npm update --n\\\n          o-ignore-scripts\n'))],
  // item 6: removing the environment without naming the variable
  'env -i npm update': ['clears the environment', wf(WENV, JOB('', '      - run: env -i npm update\n'))],
  'env - npm update': ['clears the environment', wf(WENV, JOB('', '      - run: env - npm update\n'))],
  'env --ignore-environment npm update': ['clears the environment', wf(WENV, JOB('', '      - run: env --ignore-environment npm update\n'))],
  'BASH_ENV pointing at a script': ['BASH_ENV', wf(WENV, JOB('', '      - run: BASH_ENV=./x.sh bash -c "npm update"\n'))],
  // item 7: npm 12
  'npm update --dangerously-allow-all-scripts': ['allows all scripts', wf(WENV, JOB('', '      - run: npm update --dangerously-allow-all-scripts\n'))],
  'npm_config_dangerously_allow_all_scripts=true npm update': ['allows all scripts', wf(WENV, JOB('', '      - run: npm_config_dangerously_allow_all_scripts=true npm update\n'))],
  // OMARK-111 round 3 (opus unit, e5400c0) B1: a comment or a literal backslash ending a line
  'a comment ending in a backslash above an exported override (B1)': ['touches npm_config_ignore_scripts', wf(WENV, JOB('', '      - run: |\n          # note \\\n          export npm_config_ignore_scripts=false\n          npm update\n'))],
  'a comment ending in a backslash above an override flag (B1)': ['override flag', wf(WENV, JOB('', '      - run: |\n          # note \\\n          npm update --no-ignore-scripts\n'))],
  'an escaped backslash at line end gluing env -i to the previous word (B1)': ['clears the environment', wf(WENV, JOB('', '      - run: |\n          echo a\\\\\n          env -i npm update\n'))],
  // B2: the value word after a bare flag, read with quotes and backslashes deleted
  'npm update --ignore-scripts "fa"lse (B2)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore-scripts "fa"lse\n'))],
  'npm update --ignore-scripts fals\\e (B2)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore-scripts fals\\e\n'))],
  'npm ci --ignore-scripts "fa"lse (B2, the NPM_CMD backstop)': ['without --ignore-scripts', wf(WENV, JOB('', '      - run: npm ci --ignore-scripts "fa"lse\n'))],
  // DEC-277 (a2) round 4: the strict layout allowlist
  'a > folded run scalar (B3)': ['folded block scalar', wf(WENV, JOB('', '      - run: >-\n          npm update\n'))],
  'a > folded name scalar (B3)': ['folded block scalar', wf(WENV, JOB('', '      - name: >\n          x\n        run: echo\n'))],
  'a plain-scalar continuation on a more-indented line (B3)': ['plain-scalar continuation', wf(WENV, JOB('', '      - name: i\n          continued\n        run: echo\n'))],
  'a double-quoted scalar continued on the next line (B4)': ['multi-line quoted scalar', wf(WENV, JOB('', '      - name: "fal\n          se"\n        run: echo\n'))],
  'a single-quoted scalar continued on the next line (B4)': ['multi-line quoted scalar', wf(WENV, JOB('', "      - name: 'fal\n        run: echo 'x'\n"))],
  'a backslash in a single-line plain scalar outside a body (B4)': ['backslash escape outside', wf(WENV, JOB('', '      - name: a\\b\n        run: echo\n'))],
  'a ? explicit key (B6)': ['explicit key', wf(WENV, JOB('    env:\n      ? FOO\n      : bar\n', NPMSTEP))],
  'an expression key (B6)': ['expression key', wf(WENV, JOB('    env:\n      ${{ vars.K }}: "false"\n', NPMSTEP))],
  // DEC-277 (a2) round 4: the structural shell forms
  'a brace group building the flag (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --{no-,}ignore-scripts\n'))],
  'a brace group in the flag value (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --ignore-scripts={false,true}\n'))],
  'a brace group in the variable value (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: export npm_config_ignore_scripts={false,true}\n'))],
  'a numeric brace range in an option-like token (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --ignore-scripts={0..1}\n'))],
  'ANSI-C $\'...\' quoting inside the flag (B5)': ['structural shell form', wf(WENV, JOB('', "      - run: npm update --$'ignore-scripts'=false\n"))],
  'locale $\"...\" quoting inside the flag (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --ignore-$"scripts"=false\n'))],
  'ANSI-C quoting inside the variable name (B5)': ['structural shell form', wf(WENV, JOB('', "      - run: export npm_config_ignore_$'scripts'=false\n"))],
  // round 3 reviewer (e5400c0) B3-B6 and N1, N2, N4, folded into the (a2) contract
  'a multi-line double-quoted scalar hiding an escaped flag (B4, reviewer fixture)': ['multi-line quoted scalar', wf(WENV, JOB('', '      - run: "npm update\n          --no-ignor\\x65-scripts\n          "\n'))],
  'a brace group splitting the flag name (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --{,no-}ignore-scripts\n'))],
  'a brace group inside the variable name (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: export npm_config_{ignore,x}_scripts=false\n'))],
  'ANSI-C quoting that hides the dash, inside a | body (B5)': ['structural shell form', wf(WENV, JOB('', "      - run: |\n          npm update $'\\x2d-no-ignore-scripts'\n"))],
  'an expression key as the second env entry (B6)': ['expression key', wf(WENV, JOB('    env:\n      V: 1\n      ${{ format(\'npm_config_{0}_scripts\', \'ignore\') }}: "false"\n', NPMSTEP))],
  'an alias used as an env key (B6)': ['anchor or alias', 'env:\n  npm_config_ignore_scripts: "true"\n  X: &k npm_config_ignore_scripts\njobs:\n' + JOB('    env:\n      *k : "false"\n', NPMSTEP)],
  'an explicit ? key spelling env (B6)': ['explicit key', wf(WENV, JOB('    ? env\n    : ${{ fromJSON(vars.E) }}\n', NPMSTEP))],
  'BASH_"ENV" with quotes inside the name (N1)': ['BASH_ENV', wf(WENV, JOB('', '      - run: export BASH_"ENV"=x\n'))],
  'an abbreviated --dangerously-allow (N2)': ['allows all scripts', wf(WENV, JOB('', '      - run: npm update --dangerously-allow\n'))],
  'a step running a local action (N4)': ['local action', wf(WENV, JOB('', '      - uses: ./some/action\n'))],
  // round-4 reviewer (1083683) B1-B5 and N1, N2: each accepted at 1083683, rejected after the fix
  'an anchor and alias whose name has a dot (B1)': ['anchor or alias', 'env:\n  npm_config_ignore_scripts: "true"\n  X: &k.v npm_config_ignore_scripts\njobs:\n' + JOB('    env:\n      *k.v : "false"\n', NPMSTEP)],
  'an anchor that follows a tag (B1)': ['anchor or alias', 'env:\n  npm_config_ignore_scripts: "true"\n  X: !!str &kv npm_config_ignore_scripts\njobs:\n' + JOB('', NPMSTEP)],
  'a YAML tag at a node position (B1)': ['YAML tag', wf(WENV, JOB('', '      - name: !!str x\n        run: echo\n'))],
  'a plain scalar that starts on the line after its key (B2)': ['not a key line', wf(WENV, JOB('', '      - name: i\n        run:\n          npm update --ignore-scripts\n          false\n'))],
  'a > fold whose header is on its own line (B3)': ['folded block scalar', wf(WENV, JOB('', '      - name: i\n        run:\n          >-\n            npm update --ignore-scripts\n            false\n'))],
  'a nested - - >- fold (B3)': ['folded block scalar', wf(WENV, JOB('', '      - - >-\n          npm update --ignore-scripts\n          false\n'))],
  'a brace group inside the variable name (B4a)': ['structural shell form', wf(WENV, JOB('', '      - run: export npm_conf{ig,}_ignore_scripts=false\n'))],
  '$\'..\' inside the variable name (B4a)': ['structural shell form', wf(WENV, JOB('', "      - run: export npm_conf$'ig'_ignore_scripts=false\n"))],
  'a brace group that makes the dashes (B4b)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update {x,-}-no-ignore-scripts\n'))],
  '$\'..\' in the value word after a bare flag (B5)': ['structural shell form', wf(WENV, JOB('', "      - run: npm ci --ignore-scripts fa$'lse'\n"))],
  'a brace group as the value word after a bare flag (B5)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --ignore-scripts {false,true}\n'))],
  'a brace group split across quoted words (N1)': ['structural shell form', wf(WENV, JOB('', '      - run: npm update --{no-,"x y"}ignore-scripts\n'))],
  'a STEP running ./.github/workflows/act.yml (N2: the exception is job-level only)': ['local action', wf(WENV, JOB('', '      - uses: ./.github/workflows/act.yml\n'))],
  'a job-level uses of a composite directory with no .yml suffix (N2)': ['local action', wf(WENV, '  a:\n    uses: ./.github/workflows/act\n')],
  'a step running ./.github/workflows/act as an action (N2)': ['local action', wf(WENV, JOB('', '      - uses: ./.github/workflows/act\n'))],
  // round-5 review (11c1515) B1/B3: the value-word guard's own needle, and a step second-key uses
  'a brace group as the value word after a bare flag, via the guard itself (r5 B1)': ['override flag', wf(WENV, JOB('', '      - run: npm update --ignore-scripts {false,true}\n'))],
  '$\'..\' as the value word after a bare flag, via the guard itself (r5 B1)': ['override flag', wf(WENV, JOB('', "      - run: npm ci --ignore-scripts fa$'lse'\n"))],
  'a step whose SECOND key is uses: ./.github/workflows/sub/x.yml (r5 N3)': ['local action', wf(WENV, JOB('', '      - name: x\n        uses: ./.github/workflows/sub/x.yml\n'))],
  // DEC-277 (a3): the breadth is deliberate. Each ordinary form is REFUSED, with the rule and its remedy.
  "grep -q '^x$' f (a3 ordinary form)": ['move the text into a script file the step runs', wf(WENV, JOB('', "      - run: grep -q '^x$' f\n"))],
  "awk '{print $1, $2}' (a3 ordinary form)": ['move the text into a script file the step runs', wf(WENV, JOB('', "      - run: awk '{print $1, $2}' f\n"))],
  "jq '{name, version}' (a3 ordinary form)": ['move the text into a script file the step runs', wf(WENV, JOB('', "      - run: jq '{name, version}' package.json\n"))],
  'a destructuring node -e body (a3 ordinary form)': ['move the text into a script file the step runs', wf(WENV, JOB('', "      - run: node -e \"const { a, b } = require('fs')\"\n"))],
  'echo {a,b} (a3: formerly an accepting fixture, now deliberately refused)': ['move the text into a script file the step runs', wf(WENV, JOB('', '      - run: echo {a,b}\n'))],
  'echo {a,b} inside a | body (a3: bodies included)': ['move the text into a script file the step runs', wf(WENV, JOB('', '      - run: |\n          echo {a,b}\n'))],
  'the opt-out comment above a brace-group line does not suppress it (a3)': ['move the text into a script file the step runs', wf(WENV, JOB('', '      # ignore-scripts-opt-out: this job needs scripts\n      - run: echo {a,b}\n'))],
  'the opt-out comment above a $\' line does not suppress it (a3)': ['move the text into a script file the step runs', wf(WENV, JOB('', "      # ignore-scripts-opt-out: this job needs scripts\n      - run: echo $'x'\n"))],
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
  ['a block-style env whose value is an expression (only the env: line itself is refused)', wf(WENV, JOB('', '      - name: i\n        env:\n          V: ${{ steps.q.outputs.version }}\n        run: echo "$V"\n'))],
  ['a top-level key after jobs: that is not a job, with no override', wf(WENV, JOB('', NPMSTEP)) + 'on:\n  push:\n    branches:\n      - main\n'],
  ['--ignore-scripts then --ignore-scripts=true on a subcommand NPM_CMD does not list', wf(WENV, JOB('', '      - run: npm update --ignore-scripts --ignore-scripts=true\n'))],
  ['a script path that merely contains ignore-scripts', wf(WENV, JOB('', '      - run: bash scripts/test/install-ignore-scripts.test.sh\n'))],
  ['a step opening with a block-mapping env (item 1 accept)', wf(WENV, JOB('', '      - env:\n          V: 1\n        run: echo "$V"\n'))],
  ['an env: with a trailing comment and a mapping below (item 1 accept)', wf(WENV, JOB('    env: # c\n      V: 1\n', NPMSTEP))],
  ['a double-quoted scalar with no backslash (item 2 accept)', wf(WENV, JOB('', '      - name: "i"\n        run: echo hi\n'))],
  ['a backslash and quotes inside a block-scalar body (item 2 accept)', wf(WENV, JOB('', '      - run: |\n          echo "a\\\\b"\n'))],
  ['npm_config_ignore_scripts: "true" with a real comment (item 3 accept)', wf(WENV, JOB('    env:\n      npm_config_ignore_scripts: "true" # same\n', NPMSTEP))],
  ['env -u of another variable (item 6 accept)', wf(WENV, JOB('', '      - run: env -u FOO echo hi\n'))],
  ['env with an assignment and --ignore-scripts (item 6 accept)', wf(WENV, JOB('', '      - run: env FOO=1 npm ci --ignore-scripts\n'))],
  ['--ignore-"scripts" with quotes inside, still the bare flag (item 4b accept)', wf(WENV, JOB('', '      - run: npm update --ignore-"scripts"\n'))],
  ['--inspect and --if-present are not abbreviations of the flag (item 4a accept)', wf(WENV, JOB('', '      - run: npm run build --if-present --inspect\n'))],
  ['a comment ending in a backslash above a harmless line (B1 accept)', wf(WENV, JOB('', '      - run: |\n          # note \\\n          echo hi\n'))],
  ['--ignore-scripts followed by an ordinary package word (B2 accept)', wf(WENV, JOB('', '      - run: npm install -g --ignore-scripts "x@1.2.3"\n'))],
  ['an option with a ${VAR} value (a2 accept)', wf(WENV, JOB('', '      - run: npm run build -- --registry=${REG} --prefix="${P:-x,y}"\n'))],
  ['a | body with a backslash and a name with a colon (a2 accept)', wf(WENV, JOB('', '      - name: "step: one"\n        run: |\n          echo a\\\\b\n'))],
  ['a mapping key whose children are indented (a2 accept)', wf(WENV, JOB('    env:\n      A: 1\n', NPMSTEP))],
  ['a local reusable workflow under .github/workflows (N4 accept)', wf(WENV, '  a:\n    uses: ./.github/workflows/x.yml\n')],
  ['an unrelated option and a one-letter option below the 4-character abbreviation floor (N2 accept)', wf(WENV, JOB('', '      - run: npm run build --dry-run --if-present --d\n'))],
  ['a ${X:-a,b} parameter expansion and a { ...; } group (round-4 accept)', wf(WENV, JOB('', '      - run: |\n          echo "${X:-a,b}"\n          { echo hi; }\n'))],
  ['a bang inside a quoted scalar and an expression (round-4 accept)', wf(WENV, JOB('', '      - name: "hello!"\n        if: ${{ !cancelled() }}\n        run: echo "done!"\n'))],
  ['a | header on its own line (round-4 accept)', wf(WENV, JOB('', '      - name: i\n        run:\n          |\n            echo hi\n'))],
  ['an install with a braced ${V} after the bare flag (r5 B1 accept)', wf(WENV, JOB('', '      - run: npm install -g --ignore-scripts "x@${V}"\n'))],
  ['if: with && and !cancelled() inside an expression (r5 B2 accept)', wf(WENV, JOB('', '      - name: i\n        if: ${{ success() && !cancelled() }}\n        run: echo hi\n'))],
  ['if: ${{ !cancelled() && success() }} (r5 B2 accept)', wf(WENV, JOB('', '      - name: i\n        if: ${{ !cancelled() && success() }}\n        run: echo hi\n'))],
  ['a bare if: always() && !cancelled() (r5 B2 accept)', wf(WENV, JOB('', '      - name: i\n        if: always() && !cancelled()\n        run: echo hi\n'))],
  ['a run: with `-- *.md` after ls (r5 B2 accept)', wf(WENV, JOB('', '      - run: ls -- *.md\n'))],
  ['a YAML document start marker (r5 N7 accept)', '---\n' + wf(WENV, JOB('', NPMSTEP))],
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
if (pass < 263) { console.log('ran fewer than the 263 expected passing cases'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
