# Changelog

All notable changes to the `opum-workflow` plugin. This file exists so
`check · manifests`' version-vs-changed-content guard has somewhere to point
during a stacked release (OPAG-65): plugin content can land with the version
unchanged as long as `## Unreleased` documents what's pending, and a version
bump must fold `Unreleased` into its own section — never leave both non-empty
at once. See `scripts/check-changelog-fold.mjs`.

## Unreleased

- Fixed `hooks/flush-state.sh` (SessionEnd/PreCompact) writing a durable
  tracker note on every firing regardless of whether there was anything to
  protect, which under `opum-sdlc` forced a branch and a PR to land the note
  itself, ending a session and firing the hook again — a self-sustaining
  loop observed as five straight boilerplate-only PRs in `lore-web` and
  diluting `LWEB-55`'s implementation notes to 3 substantive out of 12. The
  note is now withheld when the repository has nothing uncommitted and
  nothing unpushed; the unconditional cursor write is unaffected (OMARK-23).
  Version deliberately not bumped: OMARK-21's post-0.4.0 observation week
  (2026-09-08 to 2026-09-15) is watching the currently-deployed 0.4.0 build,
  and releasing a new version mid-week would force another fleet restart and
  reset that observation's baseline — a call for the orchestrator, not this
  fix, to make.
- Rebranded `plugin.json`'s `author.name` from `Opum` to `Opum AI`, per user
  ruling (OMARK-37). Identifiers (`name`, the marketplace slug) and
  description prose are unaffected — this is a display-field change only.

## 0.4.0

- Added four subagent definitions (`implementer`, `reviewer`, `verifier`,
  `documenter`) under `agents/`, each grounding in a Lore-compiled context
  pack before acting (OMARK-13, OPAG-52).
- Added `loop.md`, the fleet's default `/loop` prompt: starts every iteration
  from `quest task list --ready` (OMARK-13, OPAG-52).
- Fixed `hooks/notify-orchestrator.sh` relaying a foreign session's own
  "needs your input" message back as this worker's own alert (OMARK-10,
  OPAG-62).
- `opum-sdlc` states that tracker-only and docs-only chores take the
  branch-and-PR path too; a direct commit to `dev` is a defect to record, not
  a shortcut (OMARK-18, OPAG-63).

## 0.3.2

Prior history was not tracked in this file; it predates this guard.
