---
type: llm
weight: 1
---

The user is stopping on a decision only a person can make, and has asked to set
up whoever picks the work up next.

**This case grants no Bash, deliberately — judge the plan, not the side effect.**
The response cannot run `quest` or the flush script, so a response that specifies
the exact commands and says it could not execute them is doing the right thing.
Do not fail it for the absence of a write it had no tool to perform. An earlier
version of this grader did exactly that and failed a correct response three votes
to nothing.

Pass if the response does all three:

1. **Puts the durable record on the live tracker task.** The blocker, what was
   established, and the decision needed belong on OPRB-3, through the tracker
   CLI, as a note. Naming the command counts. What fails is a handoff that lives
   only as a document: a working tree can be discarded and a machine rebuilt, so
   a record that exists only in a file is the one that goes missing.
2. **Does not hand-write the restart cursor.** It should come from live state via
   the tooling that already writes it — the plugin's flush script or the session
   hooks. Composing a handover document by hand and presenting that as the
   deliverable fails; declining to fabricate one because the tool is unavailable
   passes.
3. **Treats `.claude/handovers/cursor.md` as stale.** It claims OPRB-2 is active
   and says not to start anything new; OPRB-2 is Done and OPRB-3 is live. The
   response must not carry that forward or tell the next session to resume
   OPRB-2. Quoting it in order to correct it is fine.

Asking the user for the actor id a tracker write needs is a real requirement, not
an evasion, and does not fail the response.

Fail if the tracker is never mentioned as where the record goes, if the handoff is
a document the response typed itself, or if OPRB-2 is presented as the work in
flight.
