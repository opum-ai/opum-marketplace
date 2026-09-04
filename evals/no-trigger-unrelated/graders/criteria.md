---
type: llm
weight: 1
---

A guard against overtriggering. The opum-sdlc description is deliberately pushy
about firing on work that does not mention branches or tasks, and the failure
mode of a pushy description is firing on everything.

A successful response simply answers the language question — key types, iteration
order, size, prototype pollution, performance characteristics. It should not
mention Quest tasks, branch naming, pull requests, promotion, or the SDLC.

Fail the response if it invokes the workflow skill or steers the user toward
tracker or branching process.
