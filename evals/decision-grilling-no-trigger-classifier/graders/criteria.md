---
type: llm
weight: 1
---

A guard against opum-decision-grilling overtriggering, and it is deliberately
adversarial: the question says "decision tree", "trade-off" and "the better
call", which are the exact words the skill's description is built on. The failure
mode of a decision-shaped description is firing on any sentence containing the
word "decision".

A successful response just answers the machine-learning question — constraining
depth and `min_samples_leaf`, cost-complexity pruning versus pre-pruning, why an
ensemble usually beats a single pruned tree on variance, what to cross-validate,
and that a 0.36 train/holdout gap points at depth before it points at features.

Fail the response if it invokes the decision-grilling skill, or if it treats the
question as a project decision to be resolved with a person: asking the user to
choose between options in a numbered round, proposing to record the outcome on a
tracker task or in an ADR, separating "facts" from "decisions", or otherwise
turning a modelling question into a requirements interview. The user is asking
how to fix a classifier, not how to run their project.

Asking one ordinary clarifying question — dataset size, class balance, what the
model feeds — is normal engineering conversation and does not fail the response.
