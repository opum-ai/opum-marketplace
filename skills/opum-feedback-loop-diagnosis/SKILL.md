---
name: opum-feedback-loop-diagnosis
description: Build and use a tight red-capable feedback loop for hard bugs, flaky failures, and performance regressions. Use when diagnosing, debugging, reproducing, or fixing behavior that is broken, failing, intermittent, or slow.
---

# Feedback-loop diagnosis

Diagnose from an executable signal, not a plausible theory. Preserve repository
ownership, redact secrets, and ground expected behavior in the active Lore Story,
Task, contracts, ADRs, and runbooks before choosing a fix.

## 1. Establish the exact symptom

State the user-visible failure and the authoritative expected behavior. Load the
repository's Lore implementation or verification context through the `lore`
skill when this repository carries Lore documentation. Separate product
failure, environment failure, and pre-existing failure before changing code.

Redact captured commands and output. Keep credentials in the environment and
quote only the lines that carry the diagnostic signal.

## 2. Build a red-capable loop

Create one unattended command that has already been run and can fail on the
exact symptom. Prefer, in order: a focused test, CLI fixture, HTTP probe,
browser assertion, captured-trace replay, throwaway harness, property loop,
automated bisection, or differential comparison.

The gate is complete only when the command is:

- specific enough to catch this bug rather than a nearby failure;
- deterministic, or has a pinned high reproduction rate for a flaky bug;
- fast enough for repeated use; and
- runnable without hidden human steps.

Tighten setup, inputs, and assertions before reading broadly. If no red-capable
loop can be built, stop and say so with the exact attempts and the smallest
missing artifact or environment access — ask with `AskUserQuestion` rather than
guessing past it. Do not replace a missing signal with speculation.

## 3. Reproduce and minimize

Run the loop red more than once. Remove one input, caller, configuration item,
or step at a time until every remaining element is load-bearing. Keep the
original scenario for the final proof — a minimized repro that no longer
matches the reported symptom has drifted onto a different bug.

## 4. Test ranked hypotheses

Write three to five falsifiable hypotheses. For each, name the one-variable
probe and predicted outcome. Share the ranking as a nonblocking checkpoint,
then test in order. Prefer a debugger or REPL; otherwise add narrowly placed
logs tagged `[DEBUG-<nonce>]`. For performance work, record a baseline and
profile or bisect before editing.

## 5. Lock the fix at the real seam

When a public behavior seam exists, turn the minimized repro into a failing
test at that seam, watch it fail for the right reason, apply the smallest
targeted patch, and watch it pass. If no truthful seam exists, record that
design gap instead of adding an implementation-coupled test that only proves
the patch touched the code.

## 6. Prove and clean

Re-run the minimized test and the original loop. Remove every tagged debug log
and throwaway artifact, run the relevant repository gates, and record the
confirmed root cause on the live tracker task — implementation notes or final
summary, not only the PR description, per `opum-sdlc`'s
[quest-writes reference](../opum-sdlc/references/quest-writes.md).

## What changed in this port

Adapted from Matt Pocock's `diagnosing-bugs` skill at the pinned source
recorded in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Two
things were rewritten rather than carried over: the missing-signal escalation
now names `AskUserQuestion` directly instead of "the active coordination
plane," a phrase that named FMC — retired as this fleet's coordination
mechanism — without saying so; and step 5 no longer loads a `$tdd-seams`
macro, because that skill has not shipped in this plugin yet. When it does,
step 5 should load it instead of restating the seam-testing paragraph inline.
