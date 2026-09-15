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

import { classifyEntry } from './check-federated-pins.mjs';

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
  // Scope is decided by check-federated-pins.mjs's classifyEntry, deliberately
  // shared: two checkers with two copies of "which entries are in scope" drift
  // apart silently, and a pin that fell out of scope in one but not the other
  // would be reported as verified by whichever still listed it (OMARK-57).
  const { scope, reason } = classifyEntry(p);
  if (scope === 'skipped') return null;
  if (scope === 'malformed') return `${p.name}: ${reason}`;
  const s = p.source;

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
  const verified = [];
  const skipped = [];
  for (const p of market.plugins) {
    const { scope, reason } = classifyEntry(p);
    if (scope === 'skipped') skipped.push({ name: p.name, reason });
    const problem = await checkEntry(p, baselines, apiBase);
    if (problem) problems.push(problem);
    // verified means "this run resolved its subtree and it matched", not
    // "a baseline exists for it". The old code reported the baselines file's
    // KEYS, so it named entries as verified on a run that fetched none of them.
    else if (scope === 'checked') verified.push(p.name);
  }
  return { problems, verified, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const baselines = JSON.parse(readFileSync('scripts/federated-pin-baselines.json', 'utf8'));
  // Env override mirrors FEDERATED_PIN_RAW_BASE in the pin checker, and exists
  // for the same reason: without it the CLI path - where the summary is
  // composed - is unreachable by any test, which is exactly the gap OMARK-57
  // was filed about.
  const apiBase = process.env.FEDERATED_CONTENT_API_BASE || DEFAULT_API_BASE;
  const { problems, verified, skipped } = await checkMarketplace(market, baselines, apiBase);
  for (const s of skipped) console.log(`out of scope: ${s.name} - ${s.reason}`);
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exit(1);
  }
  // An unreferenced baseline is not a failure, but it must not be counted as
  // verified either - it is a record of something this index no longer pins.
  const orphans = Object.keys(baselines).filter((k) => !k.startsWith('$') && !verified.includes(k));
  for (const o of orphans) {
    console.log(`note: baseline recorded for "${o}" but no in-scope entry of that name was resolved this run.`);
  }
  console.log(
    verified.length
      ? `federated content OK (${verified.length} of ${market.plugins.length} entries resolved and matched their baseline: ${verified.join(', ')}${skipped.length ? `; ${skipped.length} out of scope, listed above` : ''})`
      : `federated content: NOTHING WAS RESOLVED - no in-scope tag pin was checked against a baseline. This is not a pass; see the out-of-scope lines above.`,
  );
}
