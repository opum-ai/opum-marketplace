---
type: llm
weight: 1
---

A guard against overtriggering. The `opum-feedback-loop-diagnosis` description
mentions "diagnosing, debugging" broadly, and a test runner is a
debugging-adjacent topic, so the failure mode to catch is the skill firing on
any testing-related question rather than on an actual broken, failing, or slow
behavior.

Nothing in this prompt describes anything currently failing, flaky, or slow —
it's a forward-looking tooling choice. A successful response just compares
Jest and Vitest: config/ecosystem maturity, speed, ESM/TS support, watch mode,
snapshot behavior, migration cost. It should not propose building a
reproduction loop, ranking hypotheses, or diagnosing a specific bug.

Fail the response if it invokes the diagnosis skill's methodology or asks what
is currently broken.
