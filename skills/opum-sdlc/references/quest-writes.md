# The Quest write contract

Read this before planning a task, changing a status, or checking acceptance
criteria. The authoritative guidance ships inside the CLI and moves with it, so
load it just in time rather than trusting a quoted copy:

```sh
quest instructions task-execution      # before planning or status changes
quest instructions task-finalization   # before acceptance checks or closing
```

## Actor declaration

Every write needs one, and there is no `agent` kind:

```sh
--actor <session-or-tool-id> --actor-kind delegated-agent --accountable-human <user id>
```

A session is a `delegated-agent`. `human` is a misdeclaration. A missing
`--actor-kind` is rejected as *"Tracker writes require an explicit actor
declaration"*, and an invalid value names itself and lists the valid kinds.

## The lifecycle, step by step

| Step | Write |
|---|---|
| Spec | `quest task create`, or promote a draft. No branch exists before a task id does. |
| Claim | `--status "In Progress"`, then `--add-plan` with the approach |
| Develop | `--add-note` for decisions and gotchas, `--add-modified-file` as files change, `--add-reference` for PRs and docs |
| Discover new work | `quest task create` - it is a new task, not a silent addition to this one |
| Validate | `--check-ac N`, **only with evidence in hand** |
| Deliver | `--final-summary`, then `quest task complete <id>` |

An acceptance criterion you cannot prove stays unchecked, and the reason belongs
in the notes.

## Flag traps that cost real time

- **`--check-ac` is 1-based. The `index` field Quest prints is 0-based.** The
  first criterion is `--check-ac 1`, displayed as `index: 0`. Passing `0` is
  rejected as *"must be a 1-based positive integer"*.
- **One bad flag rejects the whole command.** A combined edit that sets a
  status, checks criteria and adds notes lands nothing if any single flag is
  wrong. **Never suppress stderr on a tracker write** - the rejection is the
  only thing that tells you nothing landed, and piping through `grep` hides it.
  Read the output, then verify with `quest task view <id>`.
- **Never hardcode status names.** Read `quest task status-flow`. The flow is
  enforced: a direct `To Do` to `Done` edit fails with exit 6.
- **Exit 5 is a write conflict and Quest does not retry for you.** Re-read the
  record and do a bounded retry. This matters most in hooks and loops, which
  write unattended.

## Hooks and other unattended writers

A hook is a script and has no session identity, so supply `QUEST_ACTOR` and
`QUEST_ACCOUNTABLE_HUMAN` as environment in the repository's settings rather
than hardcoding an identity into anything shipped publicly.

**A hook must never break the session.** Every failure path exits 0. A tracker
write failing at compaction time must not wedge the work.

## Lore stays coupled

`lore link <story> <TASK-ID>` writes both sides - the Story's `tasks:` list and
a `doc:<conceptId>` label on the task. `lore sync` recomputes Story status from
live task state. Read a rollup with `lore tasks <conceptId>`, **never** the
Story's own written `status`, which is only as fresh as the last sync.
`lore orphans` catches breakage in either direction.
