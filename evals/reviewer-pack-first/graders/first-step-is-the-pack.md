---
type: regex
name: first-step-is-the-pack
target: trace
pattern: "lore agent context review\\b"
flags: i
match: contains
weight: 1
---

Verifiable floor: the subagent's own response must literally name
`lore agent context review`. This checks presence, not position — the
full trace has no reliable byte offset for "the subagent's message starts
here", so ordering is the llm grader's job (whose `focus: trace` gives it
the same raw view), not this one's.
