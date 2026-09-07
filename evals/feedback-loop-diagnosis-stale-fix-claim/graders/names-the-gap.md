---
type: regex
name: names-the-gap
target: last_message
pattern: "(?=[\\s\\S]*(?:ECONNRESET|\\berr\\.code\\b|\\.code\\b))(?=[\\s\\S]*(?:status|isRetryable))"
flags: i
match: contains
weight: 0.5
---

Secondary, deterministic anchor for the same discriminator `criteria.md`
judges: a response that actually found the gap names both the real error
shape (`ECONNRESET` / `.code`) and the condition it fails to satisfy
(`status` / `isRetryable`) in the same message, not just one or the other.
