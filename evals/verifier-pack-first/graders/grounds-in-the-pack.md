---
type: llm
weight: 1
focus: last_message
---

This case has the subagent narrate its plan rather than execute anything —
no shell, edit, or write tools are available, by design (the eval sandbox
cannot run `lore` or `quest` — OPAG-45, OPAG-54 — so this case grades the
STATED first action, not an executed one).

focus: last_message, not trace: an early attempt used trace and the judge's
votes got noisier (61KB of raw JSONL - hook output, tool_use IDs, thinking
blocks - buried the actual content), not more accurate. The top-level
session's relay of what the subagent said is reliable enough to judge against;
the deterministic regex grader below already checks trace directly for the
exact phrase, so this grader doesn't need to.

Pass if, after naming `lore agent context verification --task ...` as the
first step, the rest of the plan says it will verify against the behavior the
pack says is intended (the source IDs, the architecture of record) rather
than proposing to read the repository's files directly to infer intended
behavior. It's fine for the plan to also name specific checks it expects to
run, as long as those checks are framed as grounded in the pack rather than
in independently exploring the tree first.

Fail if the plan proposes reading repository files (Read/Grep/Glob) as an
early or primary way to determine intended behavior before or instead of
compiling the pack, or never mentions grounding in the pack's returned
evidence at all.
