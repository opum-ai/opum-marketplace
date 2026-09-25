#!/usr/bin/env node
// Derives .agents/plugins/marketplace.json (Codex's own manifest contract)
// from .claude-plugin/marketplace.json (Claude's), so this repository serves
// both agent runtimes from one committed source of truth instead of two
// hand-maintained pins that can silently drift apart - the same reasoning
// federated-pin-baselines.json already applies to a pinned tag's content.
//
// Codex does not read .claude-plugin/marketplace.json's plugin entries: it
// only borrows that file's top-level "name" for a display fallback, and
// resolves plugins from .agents/plugins/marketplace.json alone (confirmed
// empirically against codex-cli 0.155.1 - `codex plugin list --json
// --available` returned zero entries from a valid .claude-plugin manifest
// with no .agents/plugins one present). Its plugin-source schema also uses
// different field names than Claude's: {source: "github", repo, ref} has no
// meaning to Codex, which needs {source: "url", url: "<full .git URL>", ref}
// - an unrecognized source.source value is dropped from `available` with no
// error anywhere, so a hand-written file with the wrong shape looks clean
// and serves nothing. OPAG-421 (routed via opum-agent).
//
// No .codex-plugin/plugin.json is required in the target repository: `codex
// plugin add` clones the pinned ref and reads that repo's own
// .claude-plugin/plugin.json to resolve the installed version, cross-checked
// against the marketplace entry's own "name" field - confirmed by installing
// opum-lore and opum-quest end to end from a clean, isolated CODEX_HOME.

// Single source of truth: throws rather than silently dropping an entry this
// generator does not yet know how to translate, so an unsupported source
// kind is a build failure, not a plugin quietly missing from Codex's index.
export function mapEntryForCodex(p) {
  const s = p.source;
  if (!s || typeof s !== 'object' || s.source !== 'github') {
    throw new Error(`${p.name}: generate-codex-marketplace only knows how to translate a "github" source, got ${JSON.stringify(s)}`);
  }
  if (!s.ref) {
    throw new Error(`${p.name}: no ref pinned - Codex's manifest must pin the same release tag as Claude's`);
  }
  return {
    name: p.name,
    source: {
      source: 'url',
      url: `https://github.com/${s.repo}.git`,
      ref: s.ref,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_USE',
    },
    ...(p.category ? { category: p.category } : {}),
  };
}

export function generateCodexMarketplace(market) {
  return {
    name: market.name,
    plugins: market.plugins.map(mapEntryForCodex),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const generated = generateCodexMarketplace(market);
  const text = `${JSON.stringify(generated, null, 2)}\n`;
  const target = '.agents/plugins/marketplace.json';

  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === text) {
      console.log(`${target} is current with .claude-plugin/marketplace.json`);
      process.exit(0);
    }
    console.log(`::error::${target} is stale - run \`node scripts/generate-codex-marketplace.mjs\` and commit the result`);
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote ${target} (${generated.plugins.length} plugin(s): ${generated.plugins.map((p) => p.name).join(', ')})`);
}
