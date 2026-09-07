#!/usr/bin/env node
// Amends "plugin content changed means the version moved" (OPAG-32's guard,
// added after the session hooks shipped at 0.1.0 and were invisible to every
// installed plugin until the version moved) to also accept a stacked
// release: content can land with the version unchanged if CHANGELOG.md's
// `## Unreleased` section documents what's pending, and the reverse check -
// a version bump must fold Unreleased into the new version's section, or a
// stacked pile of entries silently rides along on the next bump forever.
//
// Reference: opum-agent OPAG-65 (the release freeze this exists to support).

export function extractUnreleased(changelogText) {
  const lines = changelogText.split(/\r?\n/);
  let inSection = false;
  const out = [];
  for (const line of lines) {
    if (/^##\s+Unreleased\s*$/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (inSection) out.push(line);
  }
  return out.join('\n').trim();
}

// versionBefore/versionAfter: the plugin.json version at the PR's base and
// head. contentChanged: whether skills/hooks/agents/commands/plugin.json
// changed in this diff. changelogText: CHANGELOG.md at head.
export function checkRelease({ versionBefore, versionAfter, contentChanged, changelogText }) {
  const unreleased = extractUnreleased(changelogText);
  const versionMoved = versionBefore !== versionAfter;

  if (versionMoved) {
    if (unreleased.length > 0) {
      return {
        ok: false,
        reason: `version moved (${versionBefore} -> ${versionAfter}) but CHANGELOG.md's Unreleased section is not empty - fold its entries into the ## ${versionAfter} section before bumping.`,
      };
    }
    return { ok: true, reason: `version moved ${versionBefore} -> ${versionAfter}, Unreleased folded: OK` };
  }

  if (contentChanged) {
    if (unreleased.length === 0) {
      return {
        ok: false,
        reason: `plugin content changed but version is still ${versionBefore}, and CHANGELOG.md's Unreleased section is empty. Bump .claude-plugin/plugin.json, or add an entry under "## Unreleased" in CHANGELOG.md documenting what's pending a stacked release.`,
      };
    }
    return {
      ok: true,
      reason: `plugin content changed, version unchanged at ${versionBefore}, but CHANGELOG.md's Unreleased section documents it (stacked release): OK`,
    };
  }

  return { ok: true, reason: 'no plugin content changed; version bump not required' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');

  // ci.yml computes versionBefore/versionAfter/contentChanged from the git
  // diff (it already did, before this file existed) and passes them in -
  // this script owns the CHANGELOG/Unreleased rule only, not the diffing.
  const [versionBefore, versionAfter, contentChangedArg] = process.argv.slice(2);
  if (!versionBefore || !versionAfter || !contentChangedArg) {
    console.error('usage: check-changelog-fold.mjs <versionBefore> <versionAfter> <contentChanged: true|false>');
    process.exit(2);
  }
  const changelogText = readFileSync('CHANGELOG.md', 'utf8');
  const result = checkRelease({
    versionBefore,
    versionAfter,
    contentChanged: contentChangedArg === 'true',
    changelogText,
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
}
