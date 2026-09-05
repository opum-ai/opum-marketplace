---
name: opum-handoff
description: Carry work across a session boundary in an Opum repository - write a handoff, restore one, or report where a campaign stands. Use when a session is being handed over, resumed, compacted, or renewed; when someone asks what state the work is in, to pick up where a previous session left off, or to start a multi-session campaign against the tracker; and before stopping on a decision only a person can make. The tracker is Quest and the cursor is never authoritative.
---

# Opum handoff

A session ends. The work does not. This skill is how the second session starts
knowing what the first one knew, without being re-briefed by hand.

Most of it happens without you: the `opum-workflow` plugin's `PreCompact` and
`SessionEnd` hooks already flush state on their own. Reach for this skill when a
handoff needs judgement the hooks cannot supply — a reason, a blocker, a
recommendation — or when someone asks where things stand.

## The trust order, which is the whole point

Everything else in this document follows from this. State is trusted in exactly
this order, and a lower rank never overrides a higher one:

1. **The live tracker and the live repository.** `quest task view`, `git status`,
   `git log`. These are facts.
2. **The campaign Story in `docs/`.** What the campaign is for and which tasks
   belong to it.
3. **`.claude/handovers/cursor.md`.** Restart acceleration only.

**The cursor is never authoritative.** It records what a previous session
*intended* at the moment it was written; the repository may have moved since, and
that session may simply have been wrong. Its own header says so. When the cursor
disagrees with the tracker or the working tree, the cursor is what is stale —
say so in your first message rather than silently preferring one.

That ranking is not caution for its own sake. A cursor is a file in a working
tree that can be discarded, on a machine that can be rebuilt. The tracker is
committed and survives both. This is also why the flush writes the tracker
*before* the cursor: if only one of the two lands, it must be the durable one.

## Four modes

Take the mode from an explicit request. Infer it only when the intent is
unmistakable, and prefer `status` when it is not — `status` mutates nothing, so a
wrong guess costs a paragraph instead of a record.

| Mode | When | Mutates |
|---|---|---|
| `status` | "where are we", "what's left" | nothing |
| `write` | stopping on a decision, handing over, renewing | tracker + cursor |
| `restore` | starting a session on work already underway | tracker as work proceeds |
| `init` | beginning a multi-session campaign | tracker + a campaign Story |

Read the matching reference before acting:
[status and write](references/write.md), [restore](references/restore.md),
[init](references/init.md).

## Write delegates to the hook, deliberately

Do not hand-write `.claude/handovers/cursor.md`. Run the same script the hooks
run, where `$SKILL_DIR` is the base directory named when this skill loaded:

```sh
sh "$SKILL_DIR/../../hooks/flush-state.sh" write
```

Two writers of one format drift, and the one that runs unattended is the one that
must stay correct. So the skill's job is the part the hook cannot do — putting
the *reasoning* on the task first — and then letting the hook derive the rest
from live state. Details in [references/write.md](references/write.md).

The flush is silent about two things by design, and both are worth knowing before
you trust an empty result. It writes a tracker note only when **exactly one** task
is In Progress, because guessing which of several a session was on would put a
false record somewhere durable. And it writes one only when `OPUM_HOOK_ACTOR` and
`OPUM_HOOK_ACCOUNTABLE_HUMAN` are set in the repository's `.claude/settings.json`,
because a script that invented an actor id would be forging provenance. Both
failures are swallowed so a broken write can never wedge a session — which means
a missing note looks exactly like a successful one. Check `quest task view` after
a write rather than assuming.

## Working with the tracker

Quest is the tracker in every Opum repository, `.quest/` is committed, and every
write needs an explicit actor declaration:

```sh
quest task edit <id> --add-note "..." \
  --actor <session-id> --actor-kind delegated-agent --accountable-human <user id>
```

A session is a `delegated-agent`. `human` is a misdeclaration. Never edit
`.quest/` JSON directly, and never pipe a tracker write through `grep` or `tail`
— the rejection is the only thing that tells you nothing landed, and a pipeline
hides it while returning success. The full contract, including the flag traps, is
in the `opum-sdlc` skill's `references/quest-writes.md`.

## What belongs in a handoff, and what does not

- **Do not duplicate what another artifact already holds.** The tracker has the
  task, git has the diff, the PR has the review. Reference them by id or path.
  A handoff that restates them is a second copy that will disagree with the first.
- **Say what you established, not just what you were doing.** "Blocked on X"
  forces a round trip. "Blocked on X, I checked Y and Z, and would do W if nobody
  objects" usually resolves in one.
- **Name the skills the next session should reach for.** It cannot see this
  conversation, and a skill it does not know to invoke is a skill it will not use.
- **Redact.** No credentials, tokens, private endpoints, or machine paths that
  carry someone's identity. A cursor is committed-adjacent and a tracker note is
  committed outright.
- **Record a decision as a decision.** If the stop is a person's call, lead with
  the one question, and ask it with the `AskUserQuestion` tool rather than as
  prose in a final message — a question written as ordinary text ends the turn
  indistinguishably from finished work.

## Stopping

Finishing a wave, opening a PR, landing a merge, or a long transcript are not
handoff conditions. Two things are: a **decision** only a person can make, and a
**session renewal** forced by context or an environment stop.

Never leave a completed renewal cursor in place as an executable next action.
Once the successor is running, the cursor that launched it is spent — the footer
the flush writes says to delete it, and a session that does not can recursively
hand off to itself. Delete it, or rewrite it to the real stop.

## What did not survive the port from `backlog-handover`

Recorded so nobody rebuilds it. The predecessor skill was 1,396 lines across four
references and six scripts, and most of that served machinery this fleet has
retired: herdr fleet message loops with correlation ids and escalations, Opum
worktree leases, `AGENTS.md` as an authority ledger, policy-generation work-order
migration, guarded successor tabs with handover nonces, and a cursor written
under the retired Codex runtime's directory. The Backlog CLI went with the Quest
cutover.

The three bundled audit scripts are deliberately not ported either. Two audited
the format of a hand-written cursor and a hand-written campaign document, and
neither artifact is hand-written any more — the hook writes the cursor and `lore`
writes the Story, so `lore check` exiting 0 is the audit. Do not reintroduce a
format linter for a file you no longer type.
