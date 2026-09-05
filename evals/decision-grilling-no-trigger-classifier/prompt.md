---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Our churn model is a decision tree and it's badly overfitting — 0.97 on the
training split, 0.61 on holdout. Max depth is unbounded at the moment and I
haven't touched min_samples_leaf.

What's the usual way to work the depth/min-samples trade-off here, and is
pruning the better call or should I just move to a random forest?
