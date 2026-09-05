# Status and write

## Status mode

Read-only. Ground every claim against live state before reporting one, and do not
fetch from the remote merely to answer a status question.

```sh
quest task list --status "In Progress"
quest task list --ready
git status --short && git log --oneline -5
git rev-list --count '@{u}..HEAD' 2>/dev/null    # unpushed
```

Report: what is In Progress, what is ready, what is blocked and on whom, the
branch and whether it is dirty or unpushed, and **one** next action. If a cursor
exists, say whether it still matches live state — a stale cursor is worth
reporting precisely because nothing else will catch it.

Do not change a status, add a note, or write a cursor in this mode. A session
asking where things stand has not decided to stop.

## Write mode

### 1. Put the reasoning on the task first

This is the half the hook cannot do. It can see the branch, the dirty count and
the commit log; it cannot see why you stopped.

```sh
quest task edit <id> --add-note "<what you established, what is blocked, what you would do next>" \
  --actor <session-id> --actor-kind delegated-agent --accountable-human <user id>
```

Write it for someone who will trust it over their own reading, because they will.
State evidence rather than conclusions: `verified by <command>` beats "confirmed",
and an unverified belief should say that it is one.

If a criterion is genuinely met, check it — `--check-ac N`, 1-based, against the
0-based `index` Quest prints. If it is not proven, leave it open and put the
reason in the note. A criterion checked on faith is worse than one left open,
because it stops anyone else from looking.

### 2. Then flush

```sh
sh "$SKILL_DIR/../../hooks/flush-state.sh" write
```

`$SKILL_DIR` is the base directory the harness names when it loads this skill;
the plugin's `hooks/` sits two levels above it. The script writes the tracker
note first and the cursor second, and derives both from live tracker and live
repository state rather than from anything this session remembers.

### 3. Then verify

```sh
quest task view <id> | grep "Written by the opum-workflow"
head -20 .claude/handovers/cursor.md
```

Both failure paths in the flush are swallowed so a broken write can never wedge a
session, which means a missing tracker note is indistinguishable from a written
one until you look. The two reasons it stays silent:

- **More or fewer than one task In Progress.** Exactly one, or no note. Fix the
  tracker rather than the script — several tasks In Progress is usually a real
  problem, not a formatting one.
- **`OPUM_HOOK_ACTOR` or `OPUM_HOOK_ACCOUNTABLE_HUMAN` unset.** They belong in the
  repository's committed `.claude/settings.json` under `env`, where the actor
  identity is visible in review. Not in `settings.local.json`, and not hardcoded
  into anything published.

### What is not a handoff condition

A finished wave, a queued message, an opened PR, a landed merge, a completed
cleanup pass, or a transcript that feels long. Write a handoff for a **decision**
a person has to make, or a **session renewal** forced by context or an
environment stop. Anything else, keep working.

### After a renewal

The cursor that launched a successor is spent the moment the successor is
running. Delete it, or rewrite it to the actual stop. A completed renewal left in
place is an executable instruction to hand off again, and a session that follows
it hands off to itself.
