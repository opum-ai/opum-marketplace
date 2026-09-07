---
type: regex
name: proposes-branch-and-pr
target: last_message
pattern: "(?=[\\s\\S]*\\bbranch\\b)(?=[\\s\\S]*(?:\\bPR\\b|pull request))"
flags: i
match: contains
weight: 0.5
---

Secondary, deterministic anchor for the same discriminator `criteria.md`
judges: a response that actually proposes the real path names both a branch
and a PR, not just one or the other.
