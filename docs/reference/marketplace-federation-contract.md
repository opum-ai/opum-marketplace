---
# yaml-language-server: $schema=../../.lore/schemas/reference.schema.json
type: Reference
title: Marketplace federation contract
summary: What this repository is (a plugin index, not a plugin home), why every entry federates to the repo that ships the thing it names, and the constraints that follow from being public.
generated:
  by: lore/0.9.2
  at: 2026-09-25T12:44:09.074Z
---

# Marketplace federation contract

`opum-marketplace` is Opum's public Claude Code plugin index. It ships two
entries — `opum-lore` (the `lore` skill) and `opum-quest` (the `quest` skill) —
and owns no plugin content directly. `.claude-plugin/marketplace.json` is the
whole product: each entry points at the repository that actually implements
and ships the thing it names (`lore-cli` for `opum-lore`, `quest-cli` for
`opum-quest`), pinned to a tag.

## Why federated, not vendored

A skill that documents a CLI has to be cut by the same tag as the CLI, or it
drifts into describing a version nobody has installed. Keeping the `lore`
skill inside `lore-cli` (and `quest` inside `quest-cli`) makes that
structurally impossible rather than merely discouraged — there is no
opportunity for this repository's copy of a skill to diverge from the CLI
release it describes, because there is no copy.

A federated entry is added in the same change that creates the plugin it
names. An index that lists a plugin which does not resolve is broken for
everyone who adds the marketplace, so an entry is absent from
`marketplace.json` until its target plugin exists at the pinned tag.

## What changes here versus elsewhere

- **A skill's own behaviour** (what `lore` or `quest` actually does) is a
  change in `lore-cli` or `quest-cli`, never here.
- **The index itself** — adding a plugin, moving a pin forward, correcting a
  description — is a change to `.claude-plugin/marketplace.json`, validated
  by the `check · manifests` CI job (see
  [Federated pin verification](federated-pin-verification.md) for what that
  job checks beyond shape).

## Public-repository constraints

This repository is public. Nothing in it may carry an absolute machine path,
a username, an internal hostname, or a credential — a stricter bar than a
private fleet repository, because anything committed here is visible to
anyone who adds the marketplace.

## Staying current is a manual pull, not a push

`claude plugin marketplace list --json` reports only a marketplace's name,
source, and install path — no version, commit, or last-synced timestamp — so
a consumer session has no built-in signal that its local clone is behind this
repository's `main`. Nothing in this repository executes inside a consumer's
session, so it cannot push a staleness warning into one. The only refresh
mechanism is `/plugin marketplace update opum`, run explicitly before relying
on a recent change here.
