---
# yaml-language-server: $schema=../../.lore/schemas/reference.schema.json
type: Reference
title: SDLC promotion and CI gates
summary: dev is the integration branch, main is promoted from it by fast-forward push once required checks are green on that exact SHA, and the three CI jobs that gate it.
generated:
  by: lore/0.9.2
  at: 2026-09-25T12:44:14.185Z
---

# SDLC promotion and CI gates

## dev and main

`dev` is the integration branch and this repository's default branch. `main`
is promoted from it by fast-forward push once required checks are green on
the exact commit:

```
git push origin origin/dev:main
```

Push the remote-tracking ref, not local `dev` — a session recycled shortly
before a promotion can hold a stale local `dev`, and `dev:main` would promote
that stale SHA while still reporting success (ODOC-193).

**Never the merge button.** `.github/workflows/promotion-guards.yml` fails a
PR-button merge into `main` on purpose, as the detection for that mistake:
its `promotion-is-manual` job always fails on a pull request into `main` and
is deliberately not a required check, so a red X there steers a reviewer
toward the fast-forward push without blocking it. Its sibling job,
`main-is-fast-forward-of-dev`, runs on every push to `main` and asserts three
separate properties — `main` moved forward, `main`'s new HEAD came from
`dev`, and nothing was left behind — because a single "is main's HEAD
contained in dev" check reads as fast-forwardness but is strictly weaker: it
can print "genuine fast-forward" on a force-push rewind that never touched
`dev` at all (OMARK-58).

## The three required checks on main

- **`check · manifests`** — validates every `marketplace.json` entry's shape
  and its pinned tag's content; see
  [Federated pin verification](federated-pin-verification.md) for the two
  distinct things this job checks.
- **`lore check`** — validates the `docs/` bundle, installing lore and quest
  at the versions this repository itself declares (the `opum-lore` federated
  pin, and the `quest` version in `CLAUDE.md`'s managed block) rather than
  whatever happens to be preinstalled on the runner, so a green run is
  reproducible from the declaration alone (OMARK-52). It also runs
  `lore agents --check`, the drift gate for the generated Claude/Codex
  bridge files.
- **`Tracker integrity`** — confirms the Quest tracker reads cleanly and that
  `CLAUDE.md`'s managed `quest:agent-instructions` block is current for the
  declared Quest version.

## No-exemption SDLC

Every change — including a tracker-only or docs-only one — takes a branch and
a pull request into `dev`; there is no trivial-change exemption. `dev` is
promoted to `main` the same way every time: open a PR from `dev` to `main` so
the required checks run on that exact SHA, then land it with the
remote-tracking push above once they're green. See
[Marketplace federation contract](marketplace-federation-contract.md) for
what actually changes in this repository (the index) versus what changes in
`lore-cli`/`quest-cli` (the CLIs and their skills).
