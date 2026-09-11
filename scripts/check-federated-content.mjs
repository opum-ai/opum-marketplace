#!/usr/bin/env node
// Fails when a federated entry's pinned tag no longer resolves to the skill
// content we recorded having verified.
//
// The gap this closes: check-federated-pins.mjs asks "does this tag resolve,
// and does its plugin.json declare the version the pin names". Both stay true
// when a tag is deleted and recreated over different content, because the pin
// is by tag NAME and a tag name is mutable. Every consumer silently follows
// the move. That is not hypothetical - lore-cli and quest-cli both had v0.6.0
// destroyed and recreated on 2026-09-10/11 (OMARK-43). The content turned out
// to be unchanged, and nothing in CI could have told us if it had not been.
//
// So this check resolves the chain the way you would by hand -
//   refs/tags/<ref> -> tag object -> commit -> root tree -> skills subtree
// - and compares the resolved subtree SHA against scripts/federated-pin-baselines.json.
// A git tree SHA is a hash of the content beneath it, so an equal SHA is proof
// of byte-identity, not evidence of it.
//
// The no-edit property for legitimate re-tags is kept on purpose: re-creating a
// tag over IDENTICAL content resolves to the same subtree and passes untouched.
// Only a repoint that actually changes the skill fails.

const DEFAULT_API_BASE = 'https://api.github.com';

function headers() {
  const h = { 'User-Agent': 'opum-marketplace-ci', Accept: 'application/vnd.github+json' };
  // Unauthenticated is 60 requests/hour and this spends ~4 per entry. CI has
  // GITHUB_TOKEN; locally, `GITHUB_TOKEN=$(gh auth token)` avoids the cliff.
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Resolves one hop. Returns {json} or {error} - never throws, so a network
// problem reads as a named failure rather than a stack trace in CI.
async function get(apiBase, path) {
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, { headers: headers() });
  } catch (e) {
    return { error: `could not reach ${path} (${e.message})` };
  }
  if (!res.ok) {
    return { error: `${path} returned HTTP ${res.status}` };
  }
  try {
    return { json: await res.json() };
  } catch {
    return { error: `${path} did not return valid JSON` };
  }
}

// tag ref -> tag object (if annotated) -> commit -> root tree -> named subtree.
// Returns {sha} for the requested subtree, or {error}.
export async function resolveSubtree(apiBase, repo, ref, subtree) {
  const tagName = ref.replace(/^refs\/tags\//, '');
  const refRes = await get(apiBase, `/repos/${repo}/git/ref/tags/${encodeURIComponent(tagName)}`);
  if (refRes.error) return { error: refRes.error };

  const obj = refRes.json.object || {};
  let commitSha = obj.sha;
  if (obj.type === 'tag') {
    // Annotated tag: peel it. A lightweight tag points straight at the commit.
    const tagRes = await get(apiBase, `/repos/${repo}/git/tags/${obj.sha}`);
    if (tagRes.error) return { error: tagRes.error };
    commitSha = tagRes.json.object?.sha;
  }
  if (!commitSha) return { error: `${ref} in ${repo} did not peel to a commit` };

  const commitRes = await get(apiBase, `/repos/${repo}/git/commits/${commitSha}`);
  if (commitRes.error) return { error: commitRes.error };
  const rootTree = commitRes.json.tree?.sha;
  if (!rootTree) return { error: `commit ${commitSha} in ${repo} has no tree` };

  const treeRes = await get(apiBase, `/repos/${repo}/git/trees/${rootTree}`);
  if (treeRes.error) return { error: treeRes.error };
  const entry = (treeRes.json.tree || []).find((e) => e.path === subtree && e.type === 'tree');
  if (!entry) return { error: `${ref} in ${repo} has no ${subtree}/ directory at its root` };

  return { sha: entry.sha, commit: commitSha };
}

// null = nothing to check or the entry is good; a string = the problem.
export async function checkEntry(p, baselines, apiBase = DEFAULT_API_BASE) {
  const s = p.source;
  // Only tag pins are in scope. A branch pin (opum-output-styles tracks main)
  // has no fixed content by design, and a sha pin is already immutable.
  if (!s || typeof s !== 'object' || s.source !== 'github' || !s.ref || !/^v/.test(s.ref)) {
    return null;
  }

  const baseline = baselines[p.name];
  if (!baseline) {
    return `${p.name}: pinned to ${s.ref} but scripts/federated-pin-baselines.json records no verified content for it. Resolve ${s.ref}'s skills/ subtree, confirm it is what you mean to ship, and record it - an unrecorded pin cannot be told apart from a repointed one.`;
  }
  if (baseline.ref !== s.ref) {
    return `${p.name}: pin moved to ${s.ref} but the recorded baseline is still for ${baseline.ref}. Re-verify the new tag's skills/ content and update scripts/federated-pin-baselines.json in the same change that moves the pin.`;
  }

  for (const [subtree, expected] of Object.entries(baseline.trees || {})) {
    const got = await resolveSubtree(apiBase, s.repo, s.ref, subtree);
    if (got.error) return `${p.name}: ${got.error}`;
    if (got.sha !== expected) {
      return `${p.name}: ${s.ref} in ${s.repo} now resolves ${subtree}/ to ${got.sha}, but the verified baseline is ${expected}. The tag was repointed at different ${subtree} content - a tag name is mutable, so this moved without any change to this repository. Re-verify the content and update the baseline deliberately if the move was intended; do not update it to make this check pass.`;
    }
  }
  return null;
}

export async function checkMarketplace(market, baselines, apiBase = DEFAULT_API_BASE) {
  const problems = [];
  for (const p of market.plugins) {
    const problem = await checkEntry(p, baselines, apiBase);
    if (problem) problems.push(problem);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const baselines = JSON.parse(readFileSync('scripts/federated-pin-baselines.json', 'utf8'));
  const problems = await checkMarketplace(market, baselines);
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  const checked = Object.keys(baselines).filter((k) => !k.startsWith('$'));
  console.log(`federated content OK (${checked.length} pinned entry/entries verified: ${checked.join(', ')})`);
}
