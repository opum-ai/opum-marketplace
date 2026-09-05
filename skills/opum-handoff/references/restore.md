# Restore

Starting a session on work that is already underway. The goal is to be grounded
in live state within the first few commands, not to reconstruct a narrative.

## 1. Read the live tracker and the live repository first

Before opening the cursor. Reading it first anchors you to a previous session's
intent, and every later fact then gets interpreted as a deviation from it rather
than on its own terms.

```sh
quest task list --status "In Progress"
quest task view <id>
git status --short && git log --oneline -5
```

If the plugin's `SessionStart` hook ran, most of this is already in context as a
`Tracker (live)` and `Repository (live)` block. Confirm it rather than re-running
everything; it was generated at session start and is as fresh as this turn.

## 2. Then the campaign Story, if there is one

```sh
lore tasks <conceptId>        # live rollup from task state
```

Read the rollup, never the Story's own written `status` field, which is only as
fresh as the last `lore sync`.

## 3. Then the cursor, last and lightly

`.claude/handovers/cursor.md`, if it exists. Read it to restart faster, not to
decide what is true. Where it disagrees with anything above, the cursor is stale.

**Reconcile out loud.** If the cursor names a branch you are not on, a task that
has since closed, or uncommitted files that are now committed, say so in your
first message. Silent reconciliation is how a wrong cursor survives into a third
session.

Then delete it, or leave it only if its stop still stands. Its own footer says
this; a spent cursor that stays becomes a standing instruction to redo a handoff
that already happened.

## 4. Re-enter the work

Pick up the In Progress task, or the top of `quest task list --ready`. Confirm
the task is still the right one before continuing — a task can be closed by
someone else between sessions, and the fastest way to waste a restore is to
resume finished work.

Do not open a new branch for work that already has one. Do not re-derive a
decision the notes already record. If a note says something was verified, trust
it enough to build on and cheap enough to re-check when it is load-bearing.

## When there is nothing to restore

Say so plainly and stop. An empty tracker and a clean tree mean the previous
session finished, and inventing continuation work is worse than reporting that
there is none.
