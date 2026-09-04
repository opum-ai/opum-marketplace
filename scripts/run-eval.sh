#!/usr/bin/env bash
# The PLAN.md 5.3 ship gate, run locally.
#
# Run this before landing any change to skills/ or evals/, and paste the summary
# it prints into the pull request. CI does NOT run it automatically: in CI the
# suite bills ANTHROPIC_API_KEY per token (~$4.75 a run), whereas here it uses
# whatever Claude Code auth this machine already has.
#
# Flags that are not optional, and why:
#   --ablation with-without  a score with no baseline arm cannot say the plugin
#                            caused it
#   --judge-model sonnet     the default judge is haiku, below the sonnet-tier
#                            floor for llm graders
#   --scaffold               task-before-branch seeds a repo via setup.sh; the
#                            case scores 0 without it
#   --threshold 1            fail the run if any case scores below 1.0
#
# NEVER pipe this command. A shell pipeline reports its last stage's exit status,
# so `... | tee` would turn a failing suite into a green one.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/check-evals.mjs

# `set -e` would abort here on a failing suite before the summary printed, so the
# exit status is captured explicitly and re-raised at the end. A failing gate
# must still show WHICH case failed.
status=0
claude plugin eval . \
  --ablation with-without \
  --judge-model sonnet \
  --scaffold \
  --no-publish \
  --threshold 1 \
  --json evals/results/local.json || status=$?

if [ ! -f evals/results/local.json ]; then
  echo "eval produced no result file; exiting $status" >&2
  exit "${status:-1}"
fi
node -e '
  const r = require("./evals/results/local.json");
  const a = r.aggregates;
  console.log("");
  console.log(`cases ${a.casesPassed}/${a.casesTotal}  score ${a.overallScore.toFixed(3)}  mean delta ${a.meanDelta.toFixed(3)}  $${r.costUsd.toFixed(2)}`);
  for (const c of r.cases) {
    const g = c.aggregates;
    console.log(`  ${c.name.padEnd(24)} with ${g.score.toFixed(2)}  without ${(g.scoreWithout ?? 0).toFixed(2)}  delta ${(g.delta ?? 0).toFixed(2)}`);
  }
'
exit $status
