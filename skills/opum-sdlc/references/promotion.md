# Promoting `dev` to `main`

Read this when a promotion is on the table, when `main` and `dev` have already
diverged, or when it is unclear whether a promotion needs the user.

## Is a fast-forward promotion "pushing straight to `main`"?

On one occasion three sessions read that phrase three different ways within an
hour - two stopped and asked their user, one treated it as ordinary delivery.
All three were defensible, which means the phrase is ambiguous rather than any
of them being wrong.

The reading this skill applies: a promotion is **ordinary delivery** when all
four conditions hold, and needs the user directly otherwise.

1. It is a fast-forward. No `--force`, no `+` refspec.
2. The pushed commit is exactly `origin/dev`'s current tip - not a cherry-pick,
   not a rebase, not a locally-built commit.
3. Required checks are green on that exact SHA. "No checks configured" is a
   different fact from "checks passed"; say which one you have.
4. `origin/main^{tree}` equals `origin/dev^{tree}` afterwards, so the push moved
   a pointer and changed no content.

The reasoning: what the dangerous set protects against is unreviewed content
reaching `main`. A fast-forward of a reviewed, CI-green SHA that leaves the tree
identical moves a label and introduces nothing. Anything failing one of the four
- a force, a divergent SHA, a missing check, a content change - is landing
something on `main` that was not reviewed as `main`, and that is the user's call.

The invariant underneath all of it: **`main` only ever receives a fast-forward
of a `dev` that was itself gated.** A fast-forward promotion therefore satisfies
the review gates rather than bypassing them.

## The sequence

```sh
git fetch --prune origin
gh pr create --base main --head dev --title "..." --body "..."
# wait for required checks to go green on that exact SHA
gh pr checks <number>
git push origin dev:main
```

GitHub auto-marks the PR MERGED and no merge commit is created. The PR gives you
the reviewable artifact and the check run; the push preserves the fast-forward.

## Assert afterwards, both of them

```sh
git fetch --prune origin
test "$(git rev-parse origin/main^{tree})" = "$(git rev-parse origin/dev^{tree})"
git merge-base --is-ancestor origin/main origin/dev
```

Check both. Trees can match while the histories have already diverged, which is
exactly how divergence goes unnoticed: the files still agree and only the shape
of the history does not.

## Repairing a `main` that has already diverged

Using GitHub's merge button puts a merge commit on `main` that never reaches
`dev`. Four of five fleet repositories reached 10-27 such commits before anyone
noticed, because the files still matched.

The one-time repair, run on `dev`:

```sh
git merge -s ours origin/main
```

This records `main` as merged without changing `dev`'s tree, restoring the
ancestry so fast-forward promotion works again.

**Assert the safety property before running it:**

```sh
BASE=$(git merge-base origin/main origin/dev)
test "$(git rev-parse origin/main^{tree})" = "$(git rev-parse "$BASE^{tree}")"
```

`main`'s tree must equal the merge-base tree. If it does not, `main` holds
content `dev` lacks and `-s ours` will silently discard it. That assertion is
the only thing between the repair and data loss - run it, read the result, and
stop if it fails.
