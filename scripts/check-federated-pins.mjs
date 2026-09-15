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
// OMARK-57: scope is decided in ONE place, classifyEntry, and the summary the
// CLI prints is derived from that same classification. The old code reported
// `market.plugins.length` ("3 plugin(s) checked") while only ever checking
// v-prefixed tag pins, so a branch-pinned entry was silently folded into an
// affirmative count - and a pin bump that dropped the leading "v" made the
// whole check a no-op that still reported success with zero network calls.

// Decides whether an entry is in scope, and says why when it is not. Single
// source of truth: checkEntry and the CLI summary both read this, so the
// report cannot claim more than was measured.
export function classifyEntry(p) {
  const s = p.source;
  if (!s || typeof s !== 'object') {
    return { scope: 'skipped', reason: 'source is not a federated source object' };
  }
  if (s.source !== 'github') {
    return { scope: 'skipped', reason: `source kind "${s.source}" is not github` };
  }
  if (!s.ref) {
    return { scope: 'skipped', reason: s.sha ? 'pinned by sha, already immutable' : 'no ref pinned' };
  }
  if (/^v\d/.test(s.ref)) {
    return { scope: 'checked', reason: null };
  }
  // A version-shaped ref with no leading "v" would fall out of scope silently
  // and take the whole federation check with it. That is a defect in the pin,
  // not a reason to skip.
  if (/^\d+\.\d+\.\d+/.test(s.ref)) {
    return {
      scope: 'malformed',
      reason: `ref "${s.ref}" is version-shaped but has no leading "v", so it would fall out of scope and be silently unchecked. Release tags in this index are "v${s.ref}"-shaped; fix the pin rather than widening the check.`,
    };
  }
  return { scope: 'skipped', reason: `ref "${s.ref}" is not a release tag (branch pin: no fixed content by design)` };
}

// null = nothing to check or the pin is good; a string = the problem.
export async function checkEntry(p) {
  const { scope, reason } = classifyEntry(p);
  if (scope === 'skipped') return null;
  if (scope === 'malformed') return `${p.name}: ${reason}`;
  const s = p.source;
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
  const checked = [];
  const skipped = [];
  for (const p of market.plugins) {
    const { scope, reason } = classifyEntry(p);
    if (scope === 'skipped') skipped.push({ name: p.name, reason });
    const problem = await checkEntry(p);
    if (problem) problems.push(problem);
    else if (scope === 'checked') checked.push(p.name);
  }
  return { problems, checked, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const { problems, checked, skipped } = await checkMarketplace(market);
  // Say what was NOT checked, by name and reason. An entry absorbed into an
  // affirmative count is the defect this reporting exists to prevent.
  for (const s of skipped) console.log(`out of scope: ${s.name} - ${s.reason}`);
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  console.log(
    checked.length
      ? `federated pins OK (${checked.length} of ${market.plugins.length} entries checked: ${checked.join(', ')}${skipped.length ? `; ${skipped.length} out of scope, listed above` : ''})`
      : `federated pins: NOTHING WAS CHECKED - none of the ${market.plugins.length} entries is a v-prefixed tag pin. This is not a pass; see the out-of-scope lines above.`,
  );
}
