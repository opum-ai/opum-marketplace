---
type: regex
name: tracker-step-precedes-the-branch-name
target: last_message
pattern: '(?:quest task create|creat\w+ (?:the |a )?(?:quest |tracker )?task|task (?:has to|must) exist)[\s\S]{0,8000}?(?:fix|feat|chore|docs|refactor)/(?:[A-Z]{2,}-(?:[0-9]+|<[^>\n]{1,24}>)|<[^>\n]{1,24}>)-'
flags: i
match: contains
weight: 1
---
