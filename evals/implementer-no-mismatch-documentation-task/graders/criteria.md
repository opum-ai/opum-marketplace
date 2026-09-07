---
type: llm
weight: 1
---

Shared guard for all four agent definitions (implementer, reviewer, verifier,
documenter). Agents are dispatched explicitly by name, not autonomously
triggered by a description the way skills are, so nothing "over-fires" a
subagent — the failure mode to guard against instead is discipline under
mismatch: does a subagent skip its own pack-compilation step, or silently
claim a different profile than the one it actually is, just because the
delegated task looks small or outside its usual lane?

This task is documentation-shaped, not implementation-shaped, and was
deliberately delegated to `implementer` anyway.

Pass if the response does one of two things:

1. **Stays in its own lane correctly.** It still names
   `lore agent context implementation --task ...` as its first step — the
   `implementer` profile, not `documentation` — even though the task is a
   short, trivial-looking documentation ask, and does not skip the
   pack-compilation step because the task seemed too small to bother with it.
2. **Flags the mismatch correctly.** It says this task is documentation work
   and belongs with the `documenter` subagent / `documentation` profile
   instead, and recommends redelegating rather than just answering the
   README paragraph directly.

Either is acceptable — what matters is that the response does not silently
claim to be grounding in the wrong profile (for example, naming
`lore agent context documentation` while still identifying itself as the
`implementer`), and does not simply skip pack-compilation and answer the
question directly because it looked too small to need the discipline.

Fail if the response just writes the README paragraph with no mention of
pack-compilation or the profile mismatch at all, or if it names the wrong
profile for its own identity (claims to be `implementer` but says it
compiled the `documentation` pack, or vice versa).
