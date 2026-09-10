<!-- lore:agents:begin -->
This repo uses **lore** — an OKF-native documentation CLI — for the docs bundle under `docs/`.
When working on documentation, drive it through `lore` (not a plain editor) so Story <-> Task
coupling, managed blocks, and cross-links stay coherent.

- **Skill:** `.claude/skills/lore/SKILL.md` — how to drive lore.
- **Just-in-time detail:** run `lore instructions` for the canonical agent loop, then
  `lore instructions <topic>` (`linking`, `sync`, `check`, `validation`, `workspace`).
<!-- lore:agents:end -->

@~/.claude/opum-fleet-operating.md

## opum-marketplace — repository profile

Facts true of this repository only. The operating model above is byte-identical
fleet-wide; this block is where repositories legitimately differ. Keep these four
headings, in this order, in every repo, and write "None known." rather than
deleting one that has no entries yet.

### Role

Claude Code plugin marketplace for the fleet. Publishes the shared
**`opum-workflow`** plugin — currently the `opum-sdlc` and `opum-handoff`
skills plus the fleet's five session hooks — and federates **`opum-lore`** and
**`opum-quest`**, each pinned to the `lore-cli` / `quest-cli` release tag it
describes so a skill can't drift from the CLI it documents.

### Retirement machinery carried here

None known.

### What other repositories read from here

Every fleet repository resolves `opum-workflow` from `opum-ai/opum-marketplace`
via an explicit `{source: github, repo: opum-ai/opum-marketplace, ref: main}`
in `.claude-plugin/marketplace.json` (OMARK-32; was the bare string `"./"`
until 2026-09-09) — the harness reads `.claude-plugin/plugin.json` and the
`skills/`, `hooks/`, `agents/`, `commands/` directories from whatever `main`
holds. The plugin is enabled at **user** scope, so its five session hooks fire
in every repository in the fleet. No release has been tagged yet (`git tag` is
empty, both locally and on origin, checked 2026-09-07); a "release" here means
a promotion to `main` plus a `plugin.json` version bump, not a git tag — record
here, not assume, once tagging is adopted.

**One asymmetry, stated precisely rather than glossed over**: the `ref: main`
pin gates `opum-workflow`'s own content — `plugin.json` (so a version bump is
gated too, since the version field lives there, not in `marketplace.json`),
`skills/`, `hooks/`, `agents/`, `commands/`. It does **not** gate
`marketplace.json` itself. That file — which plugins are listed at all, their
`source` declarations, `opum-lore`/`opum-quest`'s pinned tags — is read from
wherever each consumer's marketplace clone is checked out, which tracks `dev`
(the default branch, unchanged by this migration) and refreshes on every
ordinary `dev` merge with no promotion gate. Verified 2026-09-09: the local
clone's `marketplace.json` was byte-identical to whatever `dev` held at last
refresh. Editing `marketplace.json` on `dev` — adding or removing a plugin,
changing a source declaration — reaches every session's next update
immediately. Closing that gap would mean pinning the marketplace's own source
in each consumer's `extraKnownMarketplaces` entry, which is local, per-user,
per-machine settings.json state outside this repo's control, and was
deliberately left alone by this migration (OMARK-29 through OMARK-32) rather
than guessed at.

`opum-lore` and `opum-quest` are federated *from* `lore-cli` and `quest-cli` at
pinned release tags; this repo reads them, not the reverse.

### Constraints and couplings to respect

- **`main` exists as of 2026-09-09 (OMARK-29 through OMARK-32, user decision
  via opum-agent OPAG-69), and `opum-sdlc`'s dev-to-main promotion step now
  applies here like every sibling repo.** `dev` stays the GitHub
  `default_branch` — checked after `main`'s creation, unchanged — matching
  every sibling's own model (`main` is never the default). `main` carries a
  `require-ci-on-main` ruleset (id `22669384`) requiring `check · eval
  structure`, `check · manifests`, `check · hook tests`, `check · operating
  block digest` as status checks; `check · plugin eval` is deliberately
  excluded (workflow_dispatch-gated, paid, never reports on an ordinary SHA —
  requiring it would make every future promotion permanently blocked, the
  same never-reports trap the two promotion-guard jobs already avoid).
  `.github/workflows/promotion-guards.yml` carries those two jobs
  (`promotion-is-manual`, `main-is-fast-forward-of-dev`), neither wired into
  required checks, for the reason documented in that file and in
  `opum-doc`'s `docs/runbooks/promote-dev-to-main.md`. This repository's own
  reason to gate `main` at all: it is a plugin marketplace consumed by every
  session in the fleet, and until this migration `dev`'s tip was what every
  consumer resolved directly, with no promotion step between a merged PR and
  what ships. See "What other repositories read from here" above for exactly
  what the gate now covers and what it still does not.
- This repository reads no file inside `opum-doc`.

<!-- quest:agent-instructions:begin -->
# Quest agent instructions

This project uses Quest CLI 0.4.0 for tracker operations. Run `quest manifest --json` to discover the supported command contract. Use `quest instructions --json` for the current versioned protocol. For Backlog tracker cutover, run `quest migration backlog preview --source <project> --json`, review its digest and mappings, then apply it with `quest migration backlog apply --source <project> --digest <digest> --actor <id> --actor-kind human --json`. Quest writes require an explicit actor declaration; do not edit Quest-authored records directly. CI should run `quest agents --check --require-installed --target claude`: current instructions exit 0, while missing, drifted, or malformed managed instructions exit 6. Quest does not retry write conflicts automatically; callers should read the latest task state and perform their own bounded retry when a command returns conflict/exit 5.
<!-- quest:agent-instructions:end -->
