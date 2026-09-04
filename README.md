# Opum Marketplace

A Claude Code plugin marketplace for the Opum fleet, and the home of the
`opum-workflow` plugin.

```
/plugin marketplace add opum-ai/opum-marketplace
/plugin install opum-workflow@opum
```

## What is here

| Plugin | Lives in | Ships |
|---|---|---|
| `opum-workflow` | this repository | the fleet's SDLC, handover, engineering and documentation skills, plus the hooks and agents that carry a session's context across a restart |
| `opum-lore` | `opum-ai/lore-cli` | the `lore` skill, cut by the same tag as the CLI it describes |
| `opum-quest` | `opum-ai/quest-cli` | the `quest` skill, cut by the same tag as the CLI it describes |

## Why the index is federated

A marketplace's `marketplace.json` can point each plugin at a different
repository, so this repository is an **index** and each plugin lives with the
thing it describes.

That is not tidiness. A skill that documents a CLI has to be cut by the same tag
as the CLI, or it drifts into describing a version nobody has installed. Keeping
the `lore` skill inside `lore-cli` makes that structurally impossible rather
than merely discouraged. `opum-workflow` sits here because nothing else public
owns it.

A federated entry is added **in the same change that creates the plugin it names**.
An index that lists a plugin which does not resolve is broken for everyone who
adds the marketplace, so `opum-lore` and `opum-quest` appear above as the intended
shape and are absent from `marketplace.json` until their plugins exist.

## What `opum-workflow` ships

### Skills

- **`opum-sdlc`** - the development lifecycle: a Quest task before a branch,
  `<type>/<TASK-ID>-<slug>` naming, a two-day and roughly 400-line ceiling,
  squash into `dev`, fast-forward `dev` to `main`. Its references carry the
  promotion mechanics and the Quest write contract.

More skills land as they pass their eval suites; a skill is not shipped by
being present in `skills/`.

## Contributing constraints

**This repository is public.** Nothing in it may carry an absolute machine path,
a username, an internal hostname, or a credential. Hooks and scripts resolve
paths from `${CLAUDE_PLUGIN_ROOT}` and `$CLAUDE_PROJECT_DIR` only. Machine- and
user-specific settings belong in a consumer's gitignored
`.claude/settings.local.json`, never here.

Every skill is authored through the official `skill-creator` plugin, checked
with `/skill-doctor`, and ships only on a passing `claude plugin eval` suite.

Validate any change before opening a PR:

```sh
claude plugin validate .
claude plugin eval .
```

## Licence

MIT. See `LICENSE`.
