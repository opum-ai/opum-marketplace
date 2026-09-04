---
type: llm
weight: 1
---

The request sounds like ordinary setup and never says "task", "tracker", "Quest"
or "process". A successful response nevertheless establishes that a **Quest task
id must exist before the branch does**, and does not simply create or suggest a
branch name as the first step.

It should also produce a branch name in the `<type>/<TASK-ID>-<slug>` shape once
a task id is available — `fix/` for a bug — rather than a free-form name.

Fail the response if it proposes creating a branch without a task id, or if it
treats the tracker step as optional or as something to do afterwards.
