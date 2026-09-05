---
type: regex
name: names-the-tooling-that-writes-the-cursor
target: last_message
pattern: 'flush-state\.sh|(?:session|pre-?compact)[- ]hook|SessionEnd|PreCompact'
flags: i
match: contains
weight: 0.5
---
