---
type: regex
name: merge-button-warned
target: last_message
pattern: '(?:merge button[^.\n]*?\b(?:not|never|n''t|avoid|trap|instead)\b|\b(?:not|never|n''t|avoid|trap|instead)\b[^.\n]*?merge button)'
flags: i
match: contains
weight: 0.5
---
