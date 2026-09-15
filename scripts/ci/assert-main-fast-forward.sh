#!/usr/bin/env bash
# WHAT THIS IS, AND WHAT IT IS NOT. This runs on push to main, after the fact.
# It REPORTS; it does not block. Whether anything actually refuses a bad push
# depends on your repo's branch rules, which are a separate mechanism - check
# `gh api repos/<owner>/<repo>/rules/branches/main` and do not assume a green
# run here means something was stopped. It also speaks only about GIT SHAPE: if
# your promotion includes a deploy, a publish or a propagation step, green here
# is not "the promotion succeeded".
#
# Three properties, each asserted and reported separately so a failure names
# which one broke. The original guard asserted only #2 and printed "genuine
# fast-forward", claiming #1 and #2 together while measuring #2 alone
# (opum-marketplace OMARK-58, lore-cli LCLI-514, quest-cli, opum-web OWEB-8).
#
#   1. main moved FORWARD          - github.event.before is an ancestor of HEAD
#   2. main's HEAD CAME FROM dev   - HEAD is contained in origin/dev
#   3. main IS dev, not part of it - nothing left behind (warning only, see below)
#
# Inputs, so this is runnable outside Actions and therefore testable at all:
#   BEFORE_SHA - github.event.before (all-zero when the branch is created)
#   FORCED     - github.event.forced ("true"/"false")
set -euo pipefail

ZERO=0000000000000000000000000000000000000000
before="${BEFORE_SHA:?BEFORE_SHA not set - refusing to report on an unmeasured previous position}"
forced="${FORCED:-false}"

# Explicit refspec (quest-web QWEB-46): bare `git fetch origin dev` relies on
# git's opportunistic remote-tracking update, which works under actions/checkout's
# narrowed refspec but is not guaranteed by it. Nothing asserted that; this does.
git fetch --no-tags --quiet origin '+refs/heads/dev:refs/remotes/origin/dev'
head_sha="$(git rev-parse HEAD)"
dev_sha="$(git rev-parse origin/dev)"

# ASSERTION 2 - came from dev. Unchanged from the original; do not drop it.
if ! git merge-base --is-ancestor "$head_sha" "$dev_sha"; then
  echo "::error::main's new HEAD ($head_sha) is not a commit dev ever held. A merge button or a direct commit produces this, and it is unrecoverable: main stops being an ancestor of dev and can never fast-forward again. See CLAUDE.md (Contributing) and opum-doc docs/runbooks/promote-dev-to-main.md, Rollback."
  exit 1
fi

# A forced push to main is never needed for a fast-forward, so its presence is
# the anomaly regardless of what the ancestor tests say. Separate, so the
# operator is told WHICH thing happened.
if [ "$forced" = "true" ]; then
  echo "::error::main was FORCE-PUSHED ($before -> $head_sha). A fast-forward promotion never requires --force. Force-push to main needs your own user's direct authority."
  exit 1
fi

# ASSERTION 1 - moved forward. The half the original never measured.
if [ "$before" = "$ZERO" ]; then
  movement="created at $head_sha (main did not exist before this push, so there is no previous position to compare)"
elif ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
  # Same missing object, two very different causes, and the guard used to name
  # only the alarming one - reporting a damaged main when the real fault was a
  # missing fetch-depth: 0 (opum-web). The exit code is deliberately unchanged:
  # an unmeasured previous position is still not a pass. Only the diagnosis
  # differs. Verified that the guard's own `git fetch --no-tags origin dev` does
  # NOT deepen a shallow clone, so this branch really is reachable that way.
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "::error::THIS CHECKOUT IS SHALLOW, so main's previous HEAD ($before) was never fetched and forward movement cannot be proven. This is a fault in the WORKFLOW, not in the promotion: the job needs actions/checkout with 'fetch-depth: 0'. main is very probably fine - fix the checkout and re-run before treating this as a damaged branch."
  else
    echo "::error::main's previous HEAD ($before) cannot be resolved in this clone, so forward movement CANNOT be proven. The clone is NOT shallow, so this is not a fetch-depth problem. Treat as an anomaly, not as a pass - an object that is gone in a full clone is usually one a rewrite orphaned."
  fi
  exit 1
elif [ "$before" = "$head_sha" ]; then
  movement="unchanged at $head_sha"
elif git merge-base --is-ancestor "$before" "$head_sha"; then
  movement="moved forward $before -> $head_sha"
else
  echo "::error::main was REWOUND or diverged: its previous HEAD ($before) is not an ancestor of its new HEAD ($head_sha). Commits that were on main are no longer on main. This passes an is-ancestor-of-dev check, which is why that check alone was not enough."
  exit 1
fi

# ASSERTION 3 - main IS dev, not merely part of it. WARNING, NOT A FAILURE, and
# the distinction is deliberate: dev legitimately advancing between the
# promotion push and this run produces a non-zero count with nothing wrong, so a
# hard fail here would cry wolf. It catches ODOC-193 - promoting a STALE LOCAL
# dev with `git push origin dev:main` instead of `origin/dev:main`, which moves
# main forward to a commit dev really holds and so satisfies 1 and 2 while
# delivering less than intended. Raised by opum-fleet, where main is the ref the
# fleet installs opum-workflow from, so a short promotion ships a stale plugin
# with everything green.
behind="$(git rev-list --count "${head_sha}..${dev_sha}")"
if [ "$behind" -gt 0 ]; then
  echo "::warning::main is $behind commit(s) BEHIND dev after this push. This check CANNOT tell those two apart - dev advancing after a correct promotion and a partial promotion look identical at the moment this runs, which is why it is a warning and not an error. If dev advanced after the promotion, this is expected and fine. If not, this was a PARTIAL promotion - the classic cause is pushing a stale local dev (git push origin dev:main) instead of the remote-tracking ref (git push origin origin/dev:main), ODOC-193. Left behind:"
  git log --oneline --no-decorate "${head_sha}..${dev_sha}" | sed 's/^/::warning::  /'
  completeness="but is $behind commit(s) behind dev (see warning)"
else
  completeness="and is dev's tip exactly, with nothing left behind"
fi

# States the three things it measured, not "genuine fast-forward" generally.
echo "main $movement; its HEAD is a commit dev holds (dev tip $dev_sha), $completeness. Reported, not enforced - see this script's header."
