#!/usr/bin/env node
// Deterministic structural gate for the eval suite.
//
// Enforces the floor invariants the `claude plugin eval init` authoring
// interview holds even when the author pushes back, plus the grader-hierarchy
// rule that an llm grader is a last resort. None of this needs a model, an API
// key, or a dollar - so it runs on every push, while the eval itself (which
// costs real money per run) is reserved for changes that can actually move it.
//
// Reference: opum-agent docs/reference/plugin-eval-authoring.md
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EVAL_DIR = 'evals';
const findings = [];
const fail = (c, m) => findings.push(`${c}: ${m}`);

const frontmatter = (file) => {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

const cases = readdirSync(EVAL_DIR).filter(
  (d) => d !== 'results' && statSync(join(EVAL_DIR, d)).isDirectory(),
);

if (cases.length === 0) fail('suite', 'no eval cases found');

let shouldNotFire = 0;

for (const name of cases) {
  const dir = join(EVAL_DIR, name);
  const promptPath = join(dir, 'prompt.md');
  const gradersDir = join(dir, 'graders');

  if (!existsSync(promptPath)) { fail(name, 'missing prompt.md'); continue; }
  if (!existsSync(gradersDir)) { fail(name, 'missing graders/'); continue; }

  const prompt = readFileSync(promptPath, 'utf8');
  if (prompt.includes('TODO: describe what the agent should do')) {
    fail(name, 'prompt.md is still the blank init template');
  }

  const fm = frontmatter(promptPath) ?? {};
  const maxTurns = Number(fm.max_turns ?? 10);

  const graders = readdirSync(gradersDir).filter((f) => f.endsWith('.md'));
  if (graders.length === 0) { fail(name, 'no graders'); continue; }

  const types = graders.map((g) => (frontmatter(join(gradersDir, g)) ?? {}).type);
  const outcome = types.filter((t) => t && t !== 'tool_used');
  if (outcome.length === 0) {
    fail(name, 'has no outcome grader - a tool_used grader must never be the only one');
  }

  // A case that reads a repository needs a budget sized to the task, not the
  // template. An under-set budget scores 0 in BOTH arms and reads as "the
  // plugin did nothing" - which is exactly how OPAG-45 hid for a full run.
  const scaffolded = existsSync(join(dir, 'case.yaml'));
  if (scaffolded && maxTurns < 20) {
    fail(name, `max_turns ${maxTurns} is under-set for a scaffolded repo-reading case (want >= 20)`);
  }

  if (scaffolded) {
    const caseYaml = readFileSync(join(dir, 'case.yaml'), 'utf8');
    const script = caseYaml.match(/scaffold_script:\s*(\S+)/)?.[1];
    if (script) {
      if (!existsSync(join(dir, script))) {
        fail(name, `case.yaml names scaffold_script ${script}, which does not exist`);
      } else if (!(statSync(join(dir, script)).mode & 0o111)) {
        fail(name, `scaffold_script ${script} is not executable`);
      }
    }
  }

  if (/should[- ]not|no[- ]trigger|unrelated/i.test(name)) shouldNotFire += 1;
}

if (shouldNotFire === 0) {
  fail('suite', 'no should-NOT-fire case - nothing guards against the skill over-triggering');
}

if (findings.length > 0) {
  console.error('eval suite structural check: FAIL');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(6);
}

console.log(`eval suite structural check: OK (${cases.length} cases, ${shouldNotFire} should-NOT-fire)`);
