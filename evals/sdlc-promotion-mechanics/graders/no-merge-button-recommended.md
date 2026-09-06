---
type: regex
name: no-merge-button-recommended
target: last_message
pattern: '^\s*(?:use|click|hit)\s+(?:the\s+)?merge button|git push (?:--force|-f)\b|--force-with-lease'
flags: im
match: not_contains
weight: 0.5
---
