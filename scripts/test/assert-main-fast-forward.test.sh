#!/usr/bin/env bash
# OMARK-58. Proof for scripts/ci/assert-main-fast-forward.sh.
#
# The original guard was written inline in a workflow `run:` block, so it could
# have no tests by construction, and it ran only on a real push to main. Every
# run was green and "green" only ever meant the other jobs passed. Five sessions
# found five independent defects in the same copied shape in one evening.
#
# MUTATION READING, measured rather than reasoned. Under the BAD fixture
# (--depth 1 --branch dev, which supplies origin/dev for free): drop assertion 1
# -> DIED, 6 red. Drop assertion 3 -> DIED, 5 red. Drop the fetch refspec ->
# SURVIVED, 0 red. So a fixture defect does NOT produce 100% mutant survival
# unless it disables the whole suite; it produces survival of exactly the
# mutants whose property that fixture disabled. That is a QUIET signal, not a
# loud one: among heterogeneous mutants it reads like "this mutant was
# equivalent".
#
# CORRECTED, OMARK-59, from opum-doc ODOC-211 running this suite verbatim. The
# paragraph above then attributed the refspec survival TO that fixture, and was
# wrong: the mutant survived the CORRECTED fixture too, 0 red, for an unrelated
# reason. A fixture fix and a missing assertion are two defects, and the first
# one being real is what made it a satisfying enough explanation to stop at. The
# actual cause is that the guard's two missing-object sites word their shallow
# diagnosis almost identically, so with the refspec dropped the EARLIER site
# answers with a message the shallow row's positives all accept. Splitting the
# second site - a fix delivered under this same task's predecessor - is what
# made the first one untested. A fix that reroutes execution can silently move a
# property out from under the assertion that covered it, so re-run the mutants
# after the fix, not only before.
#
# Three consequences for how a mutation run is gated. It must assert that EVERY
# mutant dies, named individually - a survival rate is the wrong summary when
# one survivor is the whole finding. The mutant set must actually touch the
# property in question: the refspec mutant was never run against the old
# fixture, so no reading of that run, however careful, could have caught it. And
# a surviving mutant is not explained until the explanation is MEASURED - "the
# fixture supplies it for free" was a plausible cause, held for a whole session,
# and disproved in one run by someone who re-ran it instead of reading it.
#
# FULL MUTATION RUN as of OMARK-59, each mutant PREDICTED before it was run and
# named individually. Clean tree: 17 rows, 0 failed. drop assertion 1 -> DIED, 5
# red. drop assertion 2 -> DIED, 1. drop assertion 3 -> DIED, 3. drop the fetch
# refspec -> DIED, 1 (the shallow row; it SURVIVED at 0 before this task).
# restore 2>/dev/null on the fetch -> DIED, 1 (the verbatim row). Versions,
# because two gates with identical exit codes can be measuring different things:
# bash 3.2.57 macOS, git 2.55.0, lore 0.7.0, quest 0.7.1. The CI runner's bash
# is a DIFFERENT build from macOS's 3.2.57 and this suite has never printed it,
# so no version is claimed for it here - what is measured is that the job
# reports the same 17/0 (OMARK-59: run 35026221375, step "Promotion guard has a
# passing proof suite"). If a bash-version difference ever matters, make the job
# print it rather than asserting one from the runner image's reputation.
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
# VACUITY ENUMERATION (opum-cli-e2e TASK-68), re-run 2026-09-16 after adding the
# liveness fixes, because a sweep written to catch the earlier conditions had no
# reason to look at whether the producer spoke at all. Query, so a later reader
# can re-run it rather than trust this paragraph:
#
#   grep -n '^run ' scripts/test/assert-main-fast-forward.test.sh
#   ... then for each line carrying a -"..." assertion, check it also carries
#   an exact =N (or want=green, which is exit 0 exactly) AND a +"..." positive.
#   grep -n '!/' scripts/test/report.test.mjs   # the same shape in the other suite
#
# Result, re-run at OMARK-59 after the shallow row gained a second negative: 7
# rows carry a negative, and all 7 pair it with a positive AND either an exact
# =1 or want=green, which is exit 0 exactly and so meets the exact-code
# requirement by construction. Named rather than numbered deliberately - an
# earlier revision cited "lines ~118, ~142" and the file has grown twice since,
# so the numbers now point at the wrong rows while still reading as precise. The
# two green ones are the genuine-fast-forward row and the exact-promotion row;
# the forced-push row is the one that had a positive but no exact code, and now
# has =1.
#
# What this enumeration CANNOT see: whether a message's wording drifts such that
# a positive assertion still matches while meaning something else, and casing
# drift, since grep -F is case-sensitive.
#
# opum-cli-e2e's fourth vacuity condition is the one that motivated the re-run:
# beyond (a) subject never present, (b) source empty or unreadable, (c) undefined
# interpolated id, there is (d) THE PRODUCER DIED BEFORE EMITTING ANYTHING. (d)
# is the worst of the four because the row's own harness failed, so one early
# exit turns EVERY negative in that row into a pass at once - vacuity applied to
# the suite rather than to a check. That is why the abort trap below is the
# load-bearing fix of the three and not the cosmetic one it looks like.
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
    # With a plain `git fetch origin dev`, origin/dev is never created, so the
    # script never reaches the previous-HEAD test - it stops one step earlier at
    # `rev-parse --verify -q origin/dev`. CORRECTED (ODOC-211): an earlier
    # revision of this comment said that produced a bare git fatal and exit 128,
    # and that the case below therefore caught a refspec drop. It does not. The
    # -q verify is silent and its own shallow branch annotates and exits 1 with
    # wording that satisfies every positive assertion on that case. The refspec
    # is caught by the ABSENCE assertion on that row, added for this, not by the
    # positives. How it got in: the 128 was measured against the guard BEFORE
    # the second missing-object site was split, and the comment was not re-run
    # afterwards - fixing one site is what made the other untested.
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
run "names a FORCED push distinctly from a rewind" "$C1" "$C4" true red no =1 +"FORCE-PUSHED" -"REWOUND"
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
# The last assertion is what measures the FETCH REFSPEC, and it is a negative
# because the two diagnoses are worded to overlap deliberately. Drop the refspec
# and origin/dev is never created, so the rev-parse --verify split ONE STEP
# EARLIER fires - and its message carries the same "THIS CHECKOUT IS SHALLOW",
# the same "fetch-depth: 0" and the same exit 1 this row already asserted. Every
# positive above passed under the mutant. Only the SENTENCE STEM differs, so
# only asserting the other stem's absence can tell them apart. Found by opum-doc
# (ODOC-211) running this suite verbatim; see the mutation reading in the header
# for why our own notes had misdiagnosed it as a fixture artifact.
run "a SHALLOW checkout blames the workflow, not the branch" "$C4" "$C2" false red yes =1 +"::error::" +"THIS CHECKOUT IS SHALLOW" +"fetch-depth: 0" -"rewrite orphaned" -"the fetch reported success but origin/dev still does not resolve"
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

echo "missing dev on the remote (second missing-object site)"
seed; push "$C4"
git -C "$S/origin" symbolic-ref HEAD refs/heads/main
git -C "$S/work" push -q origin --delete dev 2>/dev/null
rm -rf "$S/ci"; git clone -q "$S/origin" "$S/ci" 2>/dev/null; git -C "$S/ci" checkout -q "$C4" 2>/dev/null
out=$( cd "$S/ci" && BEFORE_SHA="$C2" FORCED=false bash "$GUARD" 2>&1 ); rc=$?
# quest-cli: this site runs one step BEFORE the previous-HEAD test, so the split
# added there cannot cover it - execution never arrives. Before the fix this was
# exit 128 with zero annotations. Exact code AND liveness, per the silence rule.
if [ "$rc" = 1 ] && grep -qF -- "::error::" <<<"$out" \
   && grep -qF -- "renamed or deleted on the remote" <<<"$out" \
   && ! grep -qF -- "THIS CHECKOUT IS SHALLOW" <<<"$out"; then
  ok "dev missing from the remote blames the remote, with an annotation, not a bare exit 128"
else
  no "dev missing from the remote" "$rc" "$out"
fi
# Separate row from the one above, so a failure names WHICH property broke: the
# verdict can be right while the content is lossy, which is exactly what the
# 2>/dev/null defect was. Asserted on "git said: fatal:" and NOT on "git said:"
# alone - the stem is a constant this script prints unconditionally, so it is
# satisfied by an EMPTY capture and would pass against the suppressed form. That
# is the satisfied-by-silence shape one layer in, on a POSITIVE assertion rather
# than a negative one. opum-doc (ODOC-211) shipped this fix and its assertion
# first; OMARK-58 had recorded the defect and prescribed it without applying it.
if grep -qF -- "git said: fatal:" <<<"$out"; then
  ok "the fetch failure quotes git verbatim rather than only this script's paraphrase"
else
  no "fetch failure discards git's own text (2>/dev/null on a FAILURE-typed exit)" "$rc" "$out"
fi


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
