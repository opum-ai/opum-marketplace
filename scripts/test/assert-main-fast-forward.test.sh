#!/usr/bin/env bash
# OMARK-58. Proof for scripts/ci/assert-main-fast-forward.sh.
#
# The original guard was written inline in a workflow `run:` block, so it could
# have no tests by construction, and it ran only on a real push to main. Every
# run was green and "green" only ever meant the other jobs passed. Five sessions
# found five independent defects in the same copied shape in one evening.
#
# Cases come in MATCHED PAIRS where two conditions produce the same exit code
# for different reasons (opum-web OWEB-8), and each asserts the ABSENCE of the
# other's wording - a single over-broad message would pass a presence-only test
# in both directions.
#
# This proves the SCRIPT'S LOGIC. It does not prove the WORKFLOW WIRING - that
# BEFORE_SHA/FORCED are populated from the github.event context and that
# fetch-depth: 0 supplies main's previous HEAD. The guard job is gated on
# push-to-main, so that stays unproven until this repository's first real
# promotion after this lands. Do not report it as proven end-to-end before then.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../ci/assert-main-fast-forward.sh"
S="$(mktemp -d)"
verdict_reached=no
# opum-web: a proof that can truncate silently is the "reads as working forever"
# failure applied to the prover. If this exits before printing its verdict, the
# PASS lines above it are not a pass - cases after the abort never ran.
cleanup() {
  local rc=$?
  rm -rf "$S"
  if [ "$verdict_reached" != yes ]; then
    echo
    echo "PROOF ABORTED EARLY (exit $rc) - the suite did not reach its verdict."
    echo "Do NOT read the PASS lines above as a pass: cases after the abort never ran."
    exit "${rc:-1}"
  fi
}
trap cleanup EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
no()  { fail=$((fail+1)); echo "  FAIL $1"; echo "       exit=$2"; echo "$3" | sed 's/^/       | /'; }

# Fresh origin with dev = c1..c4 and main starting at c2.
seed() {
  rm -rf "$S/origin" "$S/work"; mkdir -p "$S/origin"
  git init -q --bare -b dev "$S/origin"
  git clone -q "$S/origin" "$S/work" 2>/dev/null
  git -C "$S/work" config user.email t@t; git -C "$S/work" config user.name t
  for i in 1 2 3 4; do echo $i > "$S/work/f$i"; git -C "$S/work" add .; git -C "$S/work" commit -qm "c$i"; done
  git -C "$S/work" push -q origin dev
  C1=$(git -C "$S/work" rev-parse dev~3); C2=$(git -C "$S/work" rev-parse dev~2)
  C3=$(git -C "$S/work" rev-parse dev~1); C4=$(git -C "$S/work" rev-parse dev)
  git -C "$S/work" push -q origin "${C2}:refs/heads/main"
}
push() { git -C "$S/work" push -q ${2:-} origin "${1}:refs/heads/main"; }

# run <label> <main-sha> <before> <forced> <want green|red> <shallow yes|no> <assertions...>
# An assertion is  +text (must appear), -text (must NOT appear), or =N (exit
# code must be exactly N).
#
# =N and a positive assertion are both REQUIRED wherever a negative one is used.
# opum-web found the reason: a negative assertion is satisfied by SILENCE. If the
# script dies early - exit 128 from a bare git fatal, say - it emits no message,
# so every -text passes and "red" is satisfied by any non-zero. The negative
# reads like the rigorous half of a matched pair and is the half that fails open.
run() {
  local label="$1" sha="$2" before="$3" forced="$4" want="$5" shallow="$6"; shift 6
  rm -rf "$S/ci"
  if [ "$shallow" = yes ]; then
    # PRODUCTION SHAPE, and getting this wrong hid a real defect. actions/checkout
    # on a push to main with the default depth produces a SHALLOW, SINGLE-BRANCH
    # clone of MAIN - so remote.origin.fetch covers only main and `origin/dev`
    # does not exist. An earlier version of this fixture cloned --branch dev,
    # which creates origin/dev for free and made the shallow branch reachable
    # whether or not the script fetched dev correctly. lore-web caught it.
    #
    # With a plain `git fetch origin dev`, origin/dev is never created and the
    # script dies at `git rev-parse origin/dev` with a bare git fatal and EXIT
    # 128 - one line BEFORE the previous-HEAD test, so the shallow diagnosis is
    # unreachable and a missing fetch-depth: 0 surfaces as an unannotated crash.
    # The explicit refspec in the script is what makes this branch reachable at
    # all; the case below asserts that, and refspec-drop is a mutation it catches.
    # file:// is REQUIRED: git silently ignores --depth for a local PATH clone
    # and hands back a full one (opum-fleet). A fixture that quietly stops being
    # shallow is a test case that disables itself while still passing, so this
    # asserts the precondition and FAILS rather than skipping.
    git clone -q --depth 1 "file://$S/origin" --branch main "$S/ci" 2>/dev/null
    if [ "$(git -C "$S/ci" rev-parse --is-shallow-repository)" != "true" ]; then
      no "$label (FIXTURE BROKEN: clone is not shallow, so this case measures nothing)" 0 ""
      return
    fi
    # quest-web: a shallow clone holds no tree for any commit but the one it
    # landed on, so assert HEAD is the commit this case means to test rather
    # than whatever the remote's HEAD happened to name.
    if [ "$(git -C "$S/ci" rev-parse HEAD)" != "$sha" ]; then
      no "$label (FIXTURE BROKEN: HEAD is $(git -C "$S/ci" rev-parse --short HEAD), not the commit under test)" 0 ""
      return
    fi
  else
    git clone -q "$S/origin" "$S/ci" 2>/dev/null
    git -C "$S/ci" checkout -q "$sha"
  fi
  local out rc
  out=$( cd "$S/ci" && BEFORE_SHA="$before" FORCED="$forced" bash "$GUARD" 2>&1 ); rc=$?
  local got=green; [ $rc -ne 0 ] && got=red
  if [ "$got" != "$want" ]; then no "$label (wanted $want, got $got)" "$rc" "$out"; return; fi
  local a
  for a in "$@"; do
    if [ "${a:0:1}" = "+" ] && ! grep -qF -- "${a:1}" <<<"$out"; then no "$label (missing: ${a:1})" "$rc" "$out"; return; fi
    if [ "${a:0:1}" = "-" ] &&   grep -qF -- "${a:1}" <<<"$out"; then no "$label (should not say: ${a:1})" "$rc" "$out"; return; fi
    if [ "${a:0:1}" = "=" ] && [ "$rc" != "${a:1}" ]; then no "$label (wanted exit ${a:1}, got $rc - a different non-zero is a different failure)" "$rc" "$out"; return; fi
  done
  ok "$label"
}

echo "movement and containment"
seed; push "$C4"
run "accepts a genuine fast-forward promotion" "$C4" "$C2" false green no +"moved forward" +"nothing left behind" -"::warning::"
seed; push "$C4"; push "$C1" -f
run "rejects an unforced rewind (assertion 1, the original defect)" "$C1" "$C4" false red no =1 +"REWOUND" -"FORCE-PUSHED" -"::warning::"
run "names a FORCED push distinctly from a rewind" "$C1" "$C4" true red no +"FORCE-PUSHED" -"REWOUND"
seed
git -C "$S/work" checkout -q -b tmp "$C4"; git -C "$S/work" commit -q --allow-empty -m "Merge pull request #1"
M=$(git -C "$S/work" rev-parse HEAD); push "$M" -f
run "rejects a commit dev never held (assertion 2)" "$M" "$C2" false red no =1 +"not a commit dev ever held" +"unrecoverable" -"REWOUND"

echo "previous position"
seed; push "$C4"
run "accepts branch creation without claiming forward movement" "$C4" "0000000000000000000000000000000000000000" false green no +"did not exist before"
run "accepts an unchanged re-push" "$C4" "$C4" false green no +"unchanged at"
run "a full clone that cannot resolve the previous HEAD blames a rewrite" "$C4" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" false red no =1 +"::error::" +"not a fetch-depth problem" +"rewrite orphaned" -"THIS CHECKOUT IS SHALLOW"
# =1 and +::error:: are the liveness half. Without them, dropping the fetch
# refspec gives exit 128 with NO output, and -"rewrite orphaned" passes by
# silence - the branch is unreachable and the case still goes green.
run "a SHALLOW checkout blames the workflow, not the branch" "$C4" "$C2" false red yes =1 +"::error::" +"THIS CHECKOUT IS SHALLOW" +"fetch-depth: 0" -"rewrite orphaned"
rm -rf "$S/ci"; git clone -q "$S/origin" "$S/ci" 2>/dev/null; git -C "$S/ci" checkout -q "$C4"
out=$( cd "$S/ci" && BEFORE_SHA="" FORCED=false bash "$GUARD" 2>&1 ); rc=$?
[ $rc -ne 0 ] && ok "refuses to report at all when BEFORE_SHA is unset" || no "unset BEFORE_SHA passed" "$rc" "$out"

echo "completeness (warning, never a red)"
seed; push "$C4"
run "an exact promotion says nothing was left behind, and warns about nothing" "$C4" "$C2" false green no +"nothing left behind" -"::warning::"
seed; push "$C3"
run "a partial promotion (ODOC-193) WARNS and stays GREEN" "$C3" "$C2" false green no +"commit(s) BEHIND dev" +"origin/dev:main"
run "the warning names the commit left behind" "$C3" "$C2" false green no +"Left behind:" +"c4"
run "the warning says it cannot tell a partial promotion from an advancing dev" "$C3" "$C2" false green no +"CANNOT tell those two apart"

echo "workflow wiring (static)"
# lore-web's instruction-versus-explanation trap: the job's own COMMENT names
# the script path to explain the design, so a whole-file grep would stay green
# against a workflow that had stopped calling it - and would pressure a later
# author to delete the reasoning to get this green. Scoped to the `run:` lines
# inside that job's steps, with comments stripped.
wired=$(awk '/^  main-is-fast-forward-of-dev:/{f=1;next} /^  [a-z-]+:$/{f=0} f' \
          "$HERE/../../.github/workflows/promotion-guards.yml" \
        | sed 's/#.*//' | grep -E '^\s+run:')
grep -q 'scripts/ci/assert-main-fast-forward.sh' <<<"$wired" \
  && ok "the promotion-guards job actually runs the script (run: line, not a comment)" \
  || no "promotion-guards job does not run the script" 1 "$wired"

depth=$(awk '/^  main-is-fast-forward-of-dev:/{f=1;next} /^  [a-z-]+:$/{f=0} f' \
          "$HERE/../../.github/workflows/promotion-guards.yml" | sed 's/#.*//')
grep -q 'fetch-depth: 0' <<<"$depth" \
  && ok "the promotion-guards job checks out with fetch-depth: 0" \
  || no "fetch-depth: 0 missing from the guard job" 1 "$depth"

verdict_reached=yes
echo
echo "passed $pass, failed $fail"
[ $fail -eq 0 ]
