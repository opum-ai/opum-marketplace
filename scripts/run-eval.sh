#!/usr/bin/env bash
# The PLAN.md 5.3 ship gate, run locally.
#
#   ./scripts/run-eval.sh            full gate - every case. Run before a release.
#   ./scripts/run-eval.sh handoff    selective - that skill's cases, plus every
#                                    skill's should-NOT-fire case. Run before
#                                    landing a change to one skill.
#
# CI does NOT run this automatically: in CI the suite bills ANTHROPIC_API_KEY per
# token, whereas here it uses whatever Claude Code auth this machine already has.
#
# WHY THERE ARE TWO MODES, measured rather than guessed. The gate bills per run
# across ALL cases, and cost tracks agent turns almost linearly - about $0.035
# per turn per run. From the 2026-09-04 full run:
#
#   handoff-write-mechanics   15.0 turns   $3.15      scaffolded, reads a repo
#   sdlc-task-before-branch   12.2 turns   $1.76      scaffolded, reads a repo
#   sdlc-promotion-mechanics   8.2 turns   $1.31
#   sdlc-unlanded-work-safety  6.7 turns   $1.18
#   handoff-no-trigger-*       1.3 turns   $0.78      guard: answers and stops
#   sdlc-no-trigger-*          1.0 turns   $0.62      guard: answers and stops
#                                          -----
#                                          $8.46 for two skills
#
# Two skills cost $8.46. Ten would cost roughly $33 a run, which is a gate nobody
# runs, and a gate nobody runs is not a gate. The selective mode keeps the cost
# proportional to what changed.
#
# The guards ALWAYS run, even the ones belonging to other skills, and that is the
# whole point of the split. A skill's own behaviour is local to it; its
# description is not. Descriptions compete for triggering, so adding or rewording
# one skill can make a DIFFERENT skill fire on questions it used to ignore. At
# about $0.70 each they are the cheapest cases in the suite, so there is no
# reason to skip the only check that catches cross-skill regression.
#
# `--case` takes ONE glob and understands no braces and no comma lists (measured:
# `{a-*,b-*}` and `a-*,b-*` both match nothing). Selecting two groups therefore
# needs two invocations, which is why the mode below runs the tool twice and
# combines the exit codes. check-evals.mjs enforces the `<skill>-*` and
# `*no-trigger*` naming both globs depend on.
#
# Flags that are not optional, and why:
#   --ablation with-without  a score with no baseline arm cannot say the plugin
#                            caused it
#   --judge-model sonnet     the default judge is haiku, below the sonnet-tier
#                            floor for llm graders. Measured at 1% of run cost
#                            ($0.33 of $8.46), so there is nothing to save here
#   --scaffold               two cases seed a repo via setup.sh; they score 0
#                            without it
#   --threshold 1            fail the run if any case scores below 1.0
#
# NEVER pipe this command. A shell pipeline reports its last stage's exit status,
# so `... | tee` would turn a failing suite into a green one.
set -euo pipefail
cd "$(dirname "$0")/.."

SKILL="${1:-}"

node scripts/check-evals.mjs

run_arm() {
  # $1 = --case glob or empty, $2 = result file basename
  local glob="$1" out="evals/results/$2.json" status=0
  if [ -n "$glob" ]; then
    claude plugin eval . --case "$glob" \
      --ablation with-without --judge-model sonnet --scaffold \
      --no-publish --threshold 1 --json "$out" || status=$?
  else
    claude plugin eval . \
      --ablation with-without --judge-model sonnet --scaffold \
      --no-publish --threshold 1 --json "$out" || status=$?
  fi
  # `set -e` would abort before the summary printed, so the status is captured
  # and re-raised at the end. A failing gate must still show WHICH case failed.
  if [ ! -f "$out" ]; then
    echo "eval produced no result file for '${glob:-<all>}'; exiting $status" >&2
    exit "${status:-1}"
  fi
  node -e '
    const r = require("./" + process.argv[1]);
    const a = r.aggregates;
    console.log("");
    console.log(`cases ${a.casesPassed}/${a.casesTotal}  score ${a.overallScore.toFixed(3)}  mean delta ${a.meanDelta.toFixed(3)}  $${r.costUsd.toFixed(2)}`);
    for (const c of r.cases) {
      const g = c.aggregates;
      console.log(`  ${c.name.padEnd(34)} with ${g.score.toFixed(2)}  without ${(g.scoreWithout ?? 0).toFixed(2)}  delta ${(g.delta ?? 0).toFixed(2)}`);
    }
  ' "$out"
  return $status
}

overall=0
if [ -n "$SKILL" ]; then
  echo "Selective gate: ${SKILL}'s cases, plus every skill's should-NOT-fire guard."
  echo "Run without an argument for the full gate before a release."
  run_arm "${SKILL}-*" "local-${SKILL}" || overall=$?
  run_arm '*no-trigger*' "local-guards" || overall=$?
else
  run_arm "" "local" || overall=$?
fi
exit $overall
