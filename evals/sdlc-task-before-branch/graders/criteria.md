---
type: llm
weight: 1
---

Judge the order of the ACTIONS the response proposes, not the order in which it
explains things. A response may lead with a diagnosis, a caveat, or a blocker and
still pass.

Pass if the response establishes that a tracker task has to exist before the
branch does, and the sequence of steps it proposes creates or locates that task
before cutting the branch.

This is what a user would notice if the skill broke: they asked to start work,
and they ended up with a branch tied to a real task id instead of a free-form
branch and no ticket.

Fail if the proposed actions cut a branch before a task id exists, if the tracker
step is presented as optional, or if it is deferred until after the code change.
