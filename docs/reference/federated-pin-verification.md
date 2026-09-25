---
# yaml-language-server: $schema=../../.lore/schemas/reference.schema.json
type: Reference
title: Federated pin verification
summary: Why a green shape-check on marketplace.json is not enough, what scripts/federated-pin-baselines.json actually pins, and the playbook for bumping a federated pin without silently trusting a moved tag.
generated:
  by: lore/0.9.2
  at: 2026-09-25T12:44:14.104Z
---

# Federated pin verification

## Two different things a "pin" needs checked

`check · manifests` (`.github/workflows/ci.yml`) validates every
`marketplace.json` entry's shape, and on any PR touching the file, fetches
each pinned tag live to confirm its own `plugin.json` actually declares the
version being pinned. That answers "does the tag say what we claim" — it does
not answer "is the tag still the content we verified", because a tag name is
mutable: re-creating one over different content is silent, and every
consumer of this marketplace follows it without knowing it moved
(OMARK-43/OMARK-44).

`scripts/federated-pin-baselines.json` is the second check. It records each
pinned entry's resolved `skills/` subtree SHA — not the tag name, the actual
tree content the skill ships — and `scripts/check-federated-content.mjs`
re-resolves the live tag's subtree SHA and compares it against the recorded
baseline.

## The playbook for bumping a pin

Bumping `marketplace.json`'s pinned tag for an entry and updating
`scripts/federated-pin-baselines.json` are **one change, not two**:

1. Confirm the new tag's `plugin.json` declares the version being pinned
   (what `check · manifests`'s live-fetch step verifies).
2. Re-verify the new tag's `skills/` subtree content is what you intend to
   ship — read it, don't assume the version bump alone means the skill
   content is right.
3. Update `scripts/federated-pin-baselines.json` with the newly-resolved
   subtree SHA in the **same commit** as the pin bump.

Skipping step 3 fails the content check on purpose, rather than silently
passing against the wrong tag — that is the point of the baseline file
existing at all, and it is deliberate friction, not a bug to route around.

## Why this also runs off-PR

Because a tag can move with no change to this repository at all — someone
force-pushes a new commit onto an existing tag in `lore-cli` or
`quest-cli` — `check-federated-content.mjs` also runs daily and on every push
to `dev`/`main`, not only on PRs that touch `marketplace.json`. A PR-only
trigger would miss exactly the attack or mistake the baseline file exists to
catch: content moving under a pin nobody here touched.

See [Marketplace federation contract](marketplace-federation-contract.md) for what a federated entry is and
why this repository has no plugin content of its own to protect the same
way.
