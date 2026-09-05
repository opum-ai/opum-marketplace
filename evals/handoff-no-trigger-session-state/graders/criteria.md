---
type: llm
weight: 1
---

A guard against opum-handoff overtriggering, and it is deliberately adversarial:
this question contains "session", "state", "persist" and "restore", which are the
exact words the skill's description is built on. The failure mode of a
handoff-shaped description is firing on any sentence that sounds like continuity.

A successful response just answers the web question — sessionStorage and
localStorage, when each is cleared, serializing form values on input or
beforeunload, rehydrating on mount, the size limits, and why not to put anything
sensitive in either.

Fail the response if it invokes the handoff skill, or if it steers the user toward
Quest tasks, tracker records, restart cursors, handoff documents, or anything
about carrying work across agent sessions. The user is asking about a browser, not
about their own workflow.
