---
max_turns: 10
allowed_tools: ["Agent(reviewer)"]
---

Delegate this to the reviewer subagent. Tell it plainly: no shell, edit, or
write tools are available in this session — narrate the ordered plan it would
follow rather than attempting anything.

Task: review a proposed change that adds retry-with-backoff to the upload
client for correctness before it lands.
