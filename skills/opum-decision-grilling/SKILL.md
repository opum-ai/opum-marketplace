---
name: opum-decision-grilling
description: Resolve an ambiguous product, architecture, release, or campaign decision tree by separating what the repository can already settle from the choices only a person can make. Use this whenever requirements are vague, a request could be built several defensible ways, someone asks to be grilled or pushed on a plan, a spike or campaign needs its shape agreed before code is written, or work is about to start on a feature whose acceptance criteria would otherwise be invented by the session - even when the request sounds like a straightforward build task and never mentions a decision at all.
---

# Decision grilling

An ambiguous request has two kinds of gaps in it, and they are not
interchangeable. Some are **facts** — already true, discoverable, and yours to
find. The rest are **decisions** — someone's call, not derivable from anything,
and not yours to make. Confusing the two is what makes a session either invent a
specification and build against it, or hand the user a questionnaire full of
things it could have looked up.

Nearly everything in this skill follows from keeping them apart.

## Ground the decision first

Do the reading before writing a single question. A question you could have
answered yourself spends the user's attention and teaches them that answering
you is not worth the interruption — after which the questions that genuinely
need them get the same shrug.

- `CLAUDE.md` for the repository's standards, constraints and known traps.
- The tracker: `quest task view <id>`, and the surrounding tasks. A **Done**
  task's `finalSummary` and implementation notes are where a decision that looks
  open has usually already been made.
- The docs bundle through `lore` — the controlling Story, its Specs and ADRs.
  These carry the vocabulary and the constraints someone is entitled to assume
  you know.
- The code itself. What is already wired is a fact, and often the strongest
  argument for one option over another.

In a cross-repository session, read siblings but do not mutate them; ask their
owning session for facts you cannot establish from the filesystem.

When a fact needs real digging, dispatch a bounded fact-finder with one precise
question and have it return paths and evidence rather than a conclusion. Record
any finding the decision rests on where the decision will be read, not only in
the transcript.

## Then work the frontier, one round at a time

Map which decisions depend on which. The **frontier** is every unresolved
decision whose prerequisite facts and prior decisions are already settled — and
it is the whole of what you ask this round.

Ask the frontier in one round, not one question at a time. A person who agreed
to be interrupted once should not be interrupted six times.

Every question carries a **recommendation and the trade-off that would change
it**. "Which do you want?" makes the user do the analysis you were asked to do;
"I'd do A, because B costs us C — unless D matters more to you than I think"
gets an answer in one pass. You have read the repository and they have not.

A recommendation is not a decision. The failure that looks most like good work
is answering the open questions yourself, labelling the answers
"decisions I'd take so nobody stalls", and moving on — the user never gets asked,
and your judgement becomes the requirement without anyone agreeing to it. Say
what you would do and why, then leave the choice visibly theirs.

**Never put two questions in the same round when one answer changes the other.**
Asking "do we ship a preferences screen?" alongside "what goes on the
preferences screen?" forces the user to answer a question that may not exist.
Hold the dependent one; it belongs to the next frontier, if it survives.

Ask with the **`AskUserQuestion` tool, not prose in your final message.** A
question written as ordinary text ends the turn looking exactly like finished
work — the harness reports both as idle, so a pending decision reads as a
completed task and sits unnoticed. The tool makes the stop legible as a
decision.

Then recompute. An answer routinely sharpens, replaces, or deletes questions you
were holding, which is the reason for rounds rather than a single questionnaire.

## Do not build while the tree is open

No implementation, no dispatched mutation work, no rewriting who owns which
decision, while unresolved questions remain that would change what gets built.
Work done against a guess is work that has to be defended or discarded, and it
quietly converts your guess into the specification.

Groundwork that every branch of the tree needs anyway is fine. If you are unsure
whether it is that, it is not.

## Persist each round before asking the next

Resolved knowledge that lives only in the transcript is lost at the session
boundary, and the next session re-opens a decision the user already made. Write
it down where it will be read, as each round lands:

- **The tracker** for concrete behaviour and release gates — acceptance criteria
  on the task, and a note recording what was decided and why. Quest writes need
  an explicit actor:

  ```sh
  quest task edit <id> --add-note "<the decision, and the trade-off it accepted>" \
    --actor <session-id> --actor-kind delegated-agent --accountable-human <user id>
  ```

  A session is a `delegated-agent`; declaring `human` is a misdeclaration.

- **A lore ADR** for a decision that passes all three gates: it is hard to
  reverse, it would be surprising without its context, and it records a material
  trade-off. Two out of three is not an ADR — it is a note on the task or a line
  in the Spec, which is where ordering, negative requirements and numeric
  thresholds belong.

- **A separate task** for research you are deliberately deferring, owned by
  whoever will do it. Deferred work with no owner is just a thing everyone
  assumed someone else had.

## Close it out

When the frontier is empty, summarise the whole agreed contract — including the
risks accepted and the work deferred — and ask the user to confirm it. Then
reconcile what you recorded against what they confirmed; a round-by-round record
and a final summary drift, and the durable artifacts are the ones that have to
be right.

Implementation then goes to whoever owns that repository. Deciding what to build
and being the one to build it are different jobs, and this skill is only the
first.

---

Adapted from Matt Pocock's `grill-me`, `grilling` and `grill-with-docs`, via the
fleet's earlier `decision-grilling` skill; pinned sources are recorded in
`opum-agent`'s `tooling/codex-skills/THIRD_PARTY_NOTICES.md`.
