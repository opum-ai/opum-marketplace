#!/usr/bin/env node
// Fails when a federated marketplace entry pins a tag whose own
// .claude-plugin/plugin.json does not declare that same version - the defect
// that shipped in lore-cli's v0.4.3 tag (bumped package.json, not
// plugin.json) and was found by hand twice (OMARK-2, OMARK-6) before this
// existed.
//
// Self-consistency only: a pinned ref's own plugin.json must read that
// version. No diff against a previous pin is needed or attempted.
//
// null = nothing to check (local path, sha pin, or unpinned) or the pin is
// good; a string = the problem.
export async function checkEntry(p) {
  const s = p.source;
  if (!s || typeof s !== 'object' || s.source !== 'github' || !s.ref || !/^v/.test(s.ref)) {
    return null;
  }
  // Read per call, not at module load: scripts/test/ sets this after the
  // module is already imported, to point the checker at a local fixture
  // server instead of GitHub.
  const rawBase = process.env.FEDERATED_PIN_RAW_BASE || 'https://raw.githubusercontent.com';
  const expected = s.ref.replace(/^v/, '');
  const url = `${rawBase}/${s.repo}/${s.ref}/.claude-plugin/plugin.json`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'opum-marketplace-ci' } });
  } catch (e) {
    return `${p.name}: could not fetch plugin.json at ${s.ref} from ${s.repo} (${e.message})`;
  }
  if (!res.ok) {
    return `${p.name}: fetching plugin.json at ${s.ref} from ${s.repo} returned HTTP ${res.status}`;
  }
  let pinned;
  try {
    pinned = JSON.parse(await res.text());
  } catch {
    return `${p.name}: plugin.json at ${s.ref} is not valid JSON`;
  }
  if (pinned.version !== expected) {
    return `${p.name}: pinned to ${s.ref} but its plugin.json version is "${pinned.version}" - the pin moved without the plugin's own version moving.`;
  }
  return null;
}

export async function checkMarketplace(market) {
  const problems = [];
  for (const p of market.plugins) {
    const problem = await checkEntry(p);
    if (problem) problems.push(problem);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const problems = await checkMarketplace(market);
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  console.log(`federated pins OK (${market.plugins.length} plugin(s) checked)`);
}
