---
max_turns: 10
allowed_tools: ["Agent(documenter)"]
---

Delegate this to the documenter subagent. Tell it plainly: no shell, edit, or
write tools are available in this session — narrate the ordered plan it would
follow rather than attempting anything.

Task: document the new `--verbose` flag on the report CLI, including where it
belongs in the existing docs and what it should say.
