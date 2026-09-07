---
max_turns: 10
allowed_tools: ["Agent(implementer)"]
---

Delegate this to the implementer subagent. Tell it plainly: no shell, edit, or
write tools are available in this session — narrate the ordered plan it would
follow rather than attempting anything.

Task: add a `--verbose` flag to `bin/report.js` that logs each pipeline step
to stderr; stdout output must be byte-identical when the flag is absent.
