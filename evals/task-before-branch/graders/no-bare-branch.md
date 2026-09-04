---
type: regex
name: never-suggests-branching-before-a-task-exists
target: last_message
pattern: '(?:first|step 1|start by)[^.\n]{0,80}(?:git (?:checkout -b|switch -c)|cut(?:ting)? (?:a|the) branch)'
flags: i
match: not_contains
weight: 0.5
---
