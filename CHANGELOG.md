# Changelog

All notable changes to the `opum-workflow` plugin. This file exists so
`check · manifests`' version-vs-changed-content guard has somewhere to point
during a stacked release (OPAG-65): plugin content can land with the version
unchanged as long as `## Unreleased` documents what's pending, and a version
bump must fold `Unreleased` into its own section — never leave both non-empty
at once. See `scripts/check-changelog-fold.mjs`.

## Unreleased

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
