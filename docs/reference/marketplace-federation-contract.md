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

`opum-marketplace` is Opum's public Claude Code plugin index. It ships four
entries — `opum-lore` (the `lore` skill), `opum-quest` (the `quest` skill),
`opum-output-styles`, and `proof-skills` — and owns no plugin content
directly. `.claude-plugin/marketplace.json` is the whole product: each entry
points at the repository that actually implements and ships the thing it
names (`lore-cli` for `opum-lore`, `quest-cli` for `opum-quest`,
`opum-output-styles` and `proof-skills` for the entries of the same name),
pinned to a tag.

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

## Two agent runtimes, one source of truth

This repository serves both Claude Code and Codex CLI from the same four
plugins, but the two runtimes read genuinely different manifest contracts —
they are not two names for the same file. Claude Code resolves plugins from
`.claude-plugin/marketplace.json`; Codex resolves plugins from
`.agents/plugins/marketplace.json` alone, and only borrows the Claude
manifest's top-level `name` for a display fallback. It does not read that
file's `plugins` array at all, and each plugin entry's `source` shape differs
between the two: Claude's `{source: "github", repo, ref}` has no meaning to
Codex, which needs `{source: "url", url: "<full .git URL>", ref}` — an
unrecognized `source.source` value is silently dropped from Codex's
`available` list, with no error surfaced anywhere (confirmed empirically
against codex-cli 0.155.1; OPAG-421).

`.agents/plugins/marketplace.json` is therefore **generated**, never
hand-edited: `scripts/generate-codex-marketplace.mjs` derives it from
`.claude-plugin/marketplace.json`, and `node
scripts/generate-codex-marketplace.mjs --check` is the CI gate (part of
`check · manifests`) that fails the build if the two have drifted apart —
the same "derive, don't duplicate, and verify in CI" shape
[Federated pin verification](federated-pin-verification.md) already uses for
a pinned tag's content.
Neither CLI needs a `.codex-plugin/plugin.json` of its own: `codex plugin
add` clones the pinned ref and reads the target repository's own
`.claude-plugin/plugin.json` to resolve the installed version, matched
against the marketplace entry's declared name — confirmed by installing
`opum-lore` and `opum-quest` end to end from a clean, isolated `CODEX_HOME`.

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
