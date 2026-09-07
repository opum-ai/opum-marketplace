---
max_turns: 25
timeout_seconds: 700
allowed_tools: [Read, Glob, Grep, Skill]
---

Our nightly batch job still fails about twice a week with "socket hang up"
during the upload step — even though OPS-1 says this was fixed months ago.
I've dropped the incident log we finally managed to capture from last Friday
in `logs/`. What's actually going on, and what would you do?
