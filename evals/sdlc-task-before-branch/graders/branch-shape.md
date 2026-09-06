---
type: regex
name: branch-name-in-type-taskid-slug-shape
target: last_message
pattern: '(?:fix|feat|chore|docs|refactor)/(?:[A-Z]{2,}-(?:[0-9]+|<[^>\n]{1,24}>)|<[^>\n]{1,24}>)-[a-z0-9][a-z0-9-]*'
match: contains
weight: 0.5
---
