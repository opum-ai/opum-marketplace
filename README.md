# Opum Marketplace

Opum's public Claude Code plugin index: federated entries for the `lore` and
`quest` CLI skills.

```
/plugin marketplace add opum-ai/opum-marketplace
/plugin install opum-lore@opum
/plugin install opum-quest@opum
```

## What is here

| Plugin | Lives in | Ships |
|---|---|---|
| `opum-lore` | `opum-ai/lore-cli` | the `lore` skill, cut by the same tag as the CLI it describes |
| `opum-quest` | `opum-ai/quest-cli` | the `quest` skill, cut by the same tag as the CLI it describes |

## Why the index is federated

A marketplace's `marketplace.json` can point each plugin at a different
repository, so this repository is an **index**, not a home for plugin content.
Every entry here lives with the thing it describes.

That is not tidiness. A skill that documents a CLI has to be cut by the same tag
as the CLI, or it drifts into describing a version nobody has installed. Keeping
the `lore` skill inside `lore-cli` makes that structurally impossible rather
than merely discouraged.

A federated entry is added **in the same change that creates the plugin it names**.
An index that lists a plugin which does not resolve is broken for everyone who
adds the marketplace, so a federated entry is absent from `marketplace.json`
until its plugin exists at the pinned tag. `opum-lore` and `opum-quest` both
resolve now.

## Contributing

This repository owns no plugin content directly — there is nothing to author
or eval here. To change what ships:

- **A skill's own behaviour** is a change in `lore-cli` or `quest-cli`, not
  here.
- **The index itself** — adding a plugin, moving a pin forward, correcting a
  description — is a change to `.claude-plugin/marketplace.json`. `check ·
  manifests` validates every entry's shape and, on any PR touching the file,
  fetches each pinned tag live to confirm its own `plugin.json` actually
  declares the version being pinned.

**This repository is public.** Nothing in it may carry an absolute machine
path, a username, an internal hostname, or a credential.

## Licence

MIT. See `LICENSE`.
