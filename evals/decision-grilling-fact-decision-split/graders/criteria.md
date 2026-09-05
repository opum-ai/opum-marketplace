---
type: llm
weight: 1
---

The user has a vague feature request (OPRB-7, "Email digest") and wants it made
startable. Half of it was settled by earlier work in the repository; the rest are
product calls with no answer anywhere in the tree.

**Judge the plan, not side effects.** The case grants no Bash, Write or Edit, and
no user is present to answer anything. A response that names the tracker write it
would make and says it could not perform it is behaving correctly, and questions
will necessarily be posed as text. Neither is a failure.

Three things decide this. Judge each on its own, then pass only if all three hold.

**1. It read the settled constraints instead of re-opening them.** The response
should report at least two prior decisions as closed, with where each came from —
for example that mail goes through the existing `notifications.outbox` and a
broker was explicitly rejected (OPRB-4), that rendering is UTC because per-user
local time was tried and reverted (OPRB-3 / `config/defaults.json`), that
preferences are a support-set blob with no UI (OPRB-5), or that retry and
failure-parking already exist (`src/mailer.js`). Any two, attributed, is a pass.
It fails if the response puts one of these back to the user as an open question —
asking which mail provider to use, whether to add a queue, what the retry policy
should be, or which time zone to render in.

**2. The product calls are still open at the end, and visibly the user's.**
Which questions to raise is the responder's judgement; do not require any
particular one, and do not penalise it for holding a question back for a later
round — deferring a question whose answer depends on another open question is the
behaviour being looked for, not a gap. What is being measured is only this: when
the response ends, has the user been asked, or been informed? A recommendation
with its trade-off, offered for the user to confirm, passes. Answering the
questions itself and presenting the answers as settled — a list of "decisions I'd
take", assumptions baked into acceptance criteria, anything that reads as done
rather than proposed — fails, however sound the reasoning is.

**3. It did not commit to an implementation while those calls were open.**
Naming a new table or its columns, designing a sweep or scheduler, writing a set
of acceptance criteria that presume one answer, or giving a delivery estimate all
fail this point, because each one bakes in an answer nobody has given yet.
Describing what is true under every option, or sketching an option to show what
choosing it would cost, is fine.

If all three hold, pass, even if the response is shorter or narrower than you
would have written yourself.
