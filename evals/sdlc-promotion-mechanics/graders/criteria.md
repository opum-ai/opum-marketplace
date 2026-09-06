---
type: llm
weight: 1
---

The agent has no shell in this case. A procedure written for the user to run,
in order, is a complete answer; do not fail a response for saying it cannot
execute.

Judge only what a regex cannot verify. Two questions:

1. Is the reason given for avoiding GitHub's merge button the ANCESTOR
   argument — that a merge commit lands on `main` without reaching `dev`, so
   `main` stops being able to fast-forward — rather than a vaguer or wrong
   reason?
2. Does the response frame fast-forward promotion as conditional (safe once
   specific conditions hold), rather than something that always needs the
   user's direct authorisation regardless of state?

Pass if both hold. Fail if the reason given for avoiding the merge button is
missing, vague, or wrong, or if the response treats fast-forward promotion as
always needing to ask the user without reference to conditions.
