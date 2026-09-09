# opum-workflow hooks

Session lifecycle hooks shipped with the plugin. Every command in `hooks.json`
resolves from `${CLAUDE_PLUGIN_ROOT}`, which is the whole point: the two hooks
these replace named an absolute path on one machine, so four sibling
repositories had to name that path too — two of them in gitignored
`settings.local.json`, invisible to a grep of committed files.

| hook | event | what it does |
|---|---|---|
| `session-start.sh` | `SessionStart` | Restores where the last session got to |
| `pre-compact.sh` | `PreCompact` | Flushes state before the context is compressed |
| `session-end.sh` | `SessionEnd` | Flushes state before the session goes away |
| `notify-orchestrator.sh` | `Notification` | Tells the orchestrator a worker blocked or went idle |
| `report-completion.sh` | `Stop` | Records a worker finishing a turn |

`pre-compact.sh` and `session-end.sh` are two-line wrappers around
`flush-state.sh`; `_lib.sh` holds the shared helpers.

## The contract

**A hook must never break the session it is attached to.** Every failure path
exits 0. This is tested rather than asserted: `test/run-tests.sh` runs each hook
with no git repository, no tracker, an unwritable project directory, and a
project directory that does not exist.

## Trust order

State is trusted in this order, and `session-start.sh` presents it in this
order:

1. the live tracker (Quest) and live repository facts
2. the campaign document
3. the restart cursor, as acceleration only

The cursor is **never authoritative** and is labelled as such wherever it is
surfaced. A cursor records what a session *intended*; the tracker records what
actually landed. Where they disagree, the tracker wins.

## Two defects these fix

Both were live in the `lore-cli` hooks this work ports.

**The cursor was deleted by the hook that read it.** `context-recovery.sh` ran
`rm -f "$CHECKPOINT_FILE"` immediately after display. If the session then died,
was interrupted, or simply never acted on what it read, the state was gone — and
the one time a restart cursor matters most is when the previous session ended
badly. Nothing here deletes the cursor. Disposing of it is the next session's
decision.

**A session that edited nothing produced an empty handover.** `pre-compact.sh`
built its handover from `.checkpoint`, a file written only by a `PostToolUse`
hook matching `Edit|Write`. A session that read, searched, reasoned and decided
without touching a file produced a handover containing nothing — precisely the
session whose state is hardest to reconstruct. `flush-state.sh` derives state
from the live tracker and the live repository, which exist either way.

## Writing to the tracker

`flush-state.sh` appends a note to the in-progress task **before** it writes the
cursor. The cursor is a file in a working tree that may be discarded on a
machine that may be rebuilt; the tracker is committed and survives both. If only
one write lands it must be the durable one.

Three guards:

- It writes only when **exactly one** task is In Progress. Guessing which of
  several a session was on would put a false record somewhere durable, and a
  wrong durable record is worse than none — a later session trusts it over its
  own reading.
- It writes only when `OPUM_HOOK_ACTOR` and `OPUM_HOOK_ACCOUNTABLE_HUMAN` are
  set. Quest writes require an explicit actor declaration; a hook that guessed
  one would be forging provenance. Unset means no tracker write, and the cursor
  still gets written.
- It writes only when the repository has an uncommitted file or an unpushed
  commit — something the note would actually protect. A clean, fully-pushed
  tree has nothing at risk that live git and the tracker don't already show,
  and `.quest/` is committed (unlike the cursor, which the fleet gitignores),
  so writing the note anyway makes the note's own write the tree's only reason
  to need a commit. That is OMARK-23: SessionEnd fires, writes the note,
  dirties `.quest/`; landing it under `opum-sdlc` needs a branch and a PR;
  landing the PR ends a session; the hook fires again. Five straight
  `lore-web` PRs were nothing else, three of them landing on a task the ending
  session hadn't touched — it was just the sole one left In Progress. This
  guard never reaches the cursor step, which stays unconditional and already
  carries the full live-state snapshot: a read-and-reason session that edits
  nothing still gets a complete cursor, just no redundant tracker duplicate.

The actor kind is always `delegated-agent`. A session is never `human`.

## Where the cursor lives

`.claude/handovers/cursor.md` — **plural**, deliberately. Every fleet repository
gitignores that path; none ignores the singular form. A cursor written to
an untracked path is session state waiting to be swept into a commit.
`opum-marketplace` itself missed this when it joined as the eighth repository —
found and closed by OMARK-23's investigation, which is also why that repo, and
only that repo, could see the cursor rewrite (not just the tracker note)
contribute to the self-sustaining PR loop described above.

## Configuration

| variable | default | purpose |
|---|---|---|
| `OPUM_FLEET_ROOT` | `/Volumes/external/repos` | Where the fleet checkouts live |
| `OPUM_FLEET_WORKERS` | `opum-doc lore-cli quest-cli opum-cli-e2e` | Repos the reporting hooks fire in |
| `OPUM_ORCHESTRATOR_CWD` | `$OPUM_FLEET_ROOT/opum-agent` | The orchestrator's checkout |
| `OPUM_HOOK_ACTOR` | unset | Actor id for tracker writes |
| `OPUM_HOOK_ACCOUNTABLE_HUMAN` | unset | Accountable human for tracker writes |

`OPUM_FLEET_ROOT` is resolved with `pwd -P` before it is compared against a
session's resolved path. Comparing a resolved path against an unresolved one
fails exactly as silently as comparing two unresolved ones — `/Users/…/repos` is
a symlink to `/Volumes/external/repos`. The original script escaped this only by
hardcoding the real path; the moment the root became configurable, a root given
in symlink form would have matched nothing and the reporting hooks would have
gone quiet fleet-wide. There is a test for it.

## Tests

```sh
sh hooks/test/run-tests.sh
```

46 assertions, no network and no real tracker — `quest` is stubbed on `PATH`.
Run in CI on every push.
