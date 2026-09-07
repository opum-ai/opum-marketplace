---
max_turns: 10
allowed_tools: ["Agent(verifier)"]
---

Delegate this to the verifier subagent. Tell it plainly: no shell, edit, or
write tools are available in this session — narrate the ordered plan it would
follow rather than attempting anything.

Task: verify that a fix claimed to resolve intermittent upload failures
actually resolves them, before it ships.
