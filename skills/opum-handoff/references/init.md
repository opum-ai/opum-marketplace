# Init

Beginning a campaign: a set of tracker tasks that will outlive one session, with
one document saying what they are for.

Initialization is not a stopping point. Finish it and continue into the work in
the same turn.

## 1. Inventory once

```sh
quest task list --ready
```

`--ready` already applies dependency closure. From what it returns, exclude:
tasks labelled `do-not-activate`, parent containers whose children own all the
executable work, anything blocked on external state, and anything whose real
content is a decision for a person.

Order by dependency first, then priority and ordinal. Ask one scoping question
only when two readings would select materially different repositories or would
touch security, publication, or destructive state — and ask it with
`AskUserQuestion`.

## 2. Write one campaign Story

The campaign document is a `lore` Story in `docs/`, not a second task list. Quest
holds the tasks; the Story holds what they are collectively for and why this set
and not another.

```sh
lore new story "<what the campaign is for>"
lore link <story-id> <TASK-ID>   # writes both sides
lore sync && lore check
```

`lore link` writes the Story's `tasks:` list and a `doc:<conceptId>` label on the
task, so the coupling survives a session. `lore check` exiting 0 is the
definition of done for the document.

**Do not keep a third list.** Anything that dies with the session is not a record
of what is being delivered, and a hand-maintained queue in a scratch file will
disagree with the tracker within a day.

## 3. Scope is a boundary, not a licence

A campaign contract records what is in scope. It never enlarges authority: it
cannot authorize an action this session's own settings refuse, and it cannot make
one repository's session the mutation owner of another. You own the repository you
are in. Filesystem access to a sibling is not authority over it.

The dangerous set still needs a person, campaign or not: pushing a non-fast-forward
ref to `main`, force-push, history rewrite, changing remotes or credentials, and
destructive cleanup.

## 4. Then start

Move the first task to In Progress, add a plan, and work. Do not write a cursor —
initialization is not a stop, and a cursor written at the start of a campaign
describes nothing that happened.
