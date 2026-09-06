<!-- lore:agents:begin -->
This repo uses **lore** — an OKF-native documentation CLI — for the docs bundle under `docs/`.
When working on documentation, drive it through `lore` (not a plain editor) so Story <-> Task
coupling, managed blocks, and cross-links stay coherent.

- **Skill:** `.claude/skills/lore/SKILL.md` — how to drive lore.
- **Just-in-time detail:** run `lore instructions` for the canonical agent loop, then
  `lore instructions <topic>` (`linking`, `sync`, `check`, `validation`, `workspace`).
<!-- lore:agents:end -->

## Repository profile

### Constraints

- **No `main` branch exists.** `git ls-remote --heads origin` (checked 2026-09-06)
  shows only `dev`, which is also this repository's GitHub `default_branch`. No
  branch-protection rules are configured on `dev` either.
- **`opum-sdlc`'s dev-to-main promotion step does not apply here** until someone
  rules otherwise. This repository was never brought under that shape, and
  whether it should be is bound up with whether `opum-marketplace` joins the
  fleet operating block as an eighth repository - that decision belongs to the
  user, not to a session or the orchestrator. Do not create a `main` branch
  speculatively; if promotion becomes relevant, that is the trigger to revisit
  this note, not to act around it.
