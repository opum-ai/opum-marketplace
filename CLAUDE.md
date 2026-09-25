<!-- lore:agents:begin -->
This repo uses **lore** — an OKF-native documentation CLI — for the docs bundle under `docs/`.
Drive docs work through `lore` (not a plain editor or `grep`) so Story <-> Task coupling, managed
blocks, and cross-links stay coherent.

- **Find and read docs:** `lore query "<words>" --limit 5`, then `lore read <id>` for the best hit.
- **Skill:** `.claude/skills/lore/SKILL.md` — how to drive lore.
- **Just-in-time detail:** run `lore instructions` for the canonical agent loop, then
  `lore instructions <topic>` (`retrieval`, `linking`, `sync`, `check`, `validation`, `types`, `workspace`, `agents`).
<!-- lore:agents:end -->

@~/.claude/opum-fleet-operating.md

## Contributing to this repository

This repository is a public Claude Code plugin index. It owns no plugin
content directly — see `README.md` for what's here, why the index is
federated, and how to change it.

`dev` is the integration branch and the default branch. `main` is promoted
from it by fast-forward push once required checks are green on the exact
commit — `git push origin origin/dev:main` (the remote-tracking ref, not
local `dev`, which can be stale on a recycled session — ODOC-193), never
the merge button (see `.github/workflows/promotion-guards.yml`, which fails
a PR-button merge into `main` on purpose as the detection for that
mistake). `check · manifests`, `Tracker integrity` and `lore check` are the
required checks on `main`. `check · manifests` validates every
`marketplace.json` entry's shape, and on any PR touching the file, fetches
each pinned tag live to confirm its own `plugin.json` actually declares the
version being pinned. `lore check` validates the `docs/` bundle with the lore
version the `opum-lore` pin declares and the quest version this file's managed
block declares, so neither is a second hand-maintained pin (OMARK-52).

`check · manifests` also checks that a pinned tag still carries the skill
content we verified, which the version check above cannot see: a pin names a tag, and a tag name is
mutable, so re-creating one over different content is silent and every
consumer follows it (OMARK-43/OMARK-44). `scripts/federated-pin-baselines.json`
records each pinned entry's resolved `skills/` subtree SHA and
`scripts/check-federated-content.mjs` re-resolves it. Bump a pin and you must
re-verify and update that baseline in the same change, or the check fails on
purpose rather than checking the wrong tag. Because a tag can move with no
change here at all, that check also runs daily and on pushes to `dev`/`main`,
not only on PRs.

<!-- quest:agent-instructions:begin -->
# Quest agent instructions

This project uses Quest CLI 0.10.0 for tracker operations. Run `quest manifest --json` to discover the supported command contract.

Read the matching guide before tracker work: `quest instructions overview` for the command set and machine contract, `quest instructions task-creation` before creating or splitting tasks, `quest instructions task-execution` before claiming, planning, or recording progress, `quest instructions task-finalization` before checking acceptance criteria or closing a task, and `quest instructions workspace` for initialization, managed instructions, and Backlog.md migration. `quest instructions --list` lists every guide. Search for an existing record with `quest search "<query>" --json` before creating one, and run `quest help <command>` for a command's options and examples.

Quest writes require an explicit actor declaration: `--actor <id> --actor-kind human` for a person, or `--actor <id> --actor-kind delegated-agent --accountable-human <id>` for an agent acting on a person's behalf. Do not edit Quest-authored records directly. CI should run `quest agents --check --require-installed --target claude`: current instructions, and a version-only difference (only the pinned Quest CLI version number is stale) both exit 0; missing, drifted, or malformed managed instructions exit 6. Quest does not retry write conflicts automatically; callers should read the latest task state and perform their own bounded retry when a command returns conflict/exit 5.
<!-- quest:agent-instructions:end -->
