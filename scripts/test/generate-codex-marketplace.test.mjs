#!/usr/bin/env node
// Regression test for ../generate-codex-marketplace.mjs. Proves the
// translation is correct (github source -> url/.git source, ref carried
// over, category carried over) and that an unsupported source kind fails
// loud instead of silently vanishing from Codex's manifest.
import { mapEntryForCodex, generateCodexMarketplace } from '../generate-codex-marketplace.mjs';

let pass = 0;
let fail = 0;
const ok = (label) => {
  pass++;
  console.log(`  ok   ${label}`);
};
const bad = (label, detail) => {
  fail++;
  console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
};

// A github-sourced entry translates to Codex's url/.git shape with the same
// ref, plus a policy Codex requires and Claude has no concept of.
{
  const entry = mapEntryForCodex({
    name: 'opum-lore',
    source: { source: 'github', repo: 'opum-ai/lore-cli', ref: 'v0.9.3' },
    category: 'documentation',
  });
  const want = JSON.stringify({
    name: 'opum-lore',
    source: { source: 'url', url: 'https://github.com/opum-ai/lore-cli.git', ref: 'v0.9.3' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'documentation',
  });
  JSON.stringify(entry) === want
    ? ok('a github source translates to Codex\'s url/.git shape with ref and category carried over')
    : bad('translation mismatch', JSON.stringify(entry));
}

// A source Claude allows (git-subdir, per the manifest-shape CI check) but
// this generator does not yet translate must fail loud, not silently drop
// the plugin from Codex's available list the way an unrecognized source
// does inside Codex itself - that silent-drop is the exact defect this file
// exists to route around, so the generator must not reproduce it.
{
  try {
    mapEntryForCodex({ name: 'untranslated', source: { source: 'git-subdir', url: 'https://example.com/x.git', path: '.' } });
    bad('an unsupported source kind should have thrown, not returned an entry');
  } catch (e) {
    /only knows how to translate a "github" source/.test(e.message)
      ? ok('an unsupported source kind throws instead of silently dropping the plugin')
      : bad('threw, but not the expected message', e.message);
  }
}

// An unpinned github source (no ref) must also fail loud: Codex's manifest
// exists to serve the same pinned tag Claude's does, and a driftable branch
// pin defeats that silently if allowed through.
{
  try {
    mapEntryForCodex({ name: 'unpinned', source: { source: 'github', repo: 'opum-ai/x' } });
    bad('an unpinned github source should have thrown');
  } catch (e) {
    /no ref pinned/.test(e.message)
      ? ok('an unpinned github source throws instead of silently dropping the plugin')
      : bad('threw, but not the expected message', e.message);
  }
}

// The whole-marketplace wrapper carries the top-level name through unchanged
// (Codex borrows it for display) and maps every entry.
{
  const generated = generateCodexMarketplace({
    name: 'opum',
    plugins: [
      { name: 'opum-lore', source: { source: 'github', repo: 'opum-ai/lore-cli', ref: 'v0.9.3' }, category: 'documentation' },
      { name: 'opum-quest', source: { source: 'github', repo: 'opum-ai/quest-cli', ref: 'v0.10.0' }, category: 'workflow' },
    ],
  });
  generated.name === 'opum' && generated.plugins.length === 2 && generated.plugins.every((p) => p.source.source === 'url')
    ? ok('the marketplace wrapper carries the name through and maps every entry')
    : bad('wrapper output unexpected', JSON.stringify(generated));
}

console.log('');
console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
