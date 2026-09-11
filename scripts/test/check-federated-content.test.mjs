#!/usr/bin/env node
// Regression test for ../check-federated-content.mjs. Proves the guard
// actually fails on a repointed tag, a stale baseline and a missing one - a
// guard that cannot fail has the shape of a gate without the effect. No
// network: serves a fake GitHub git-database API from a local server.
//
// The fixtures model the real chain, annotated tag included, because peeling
// the tag object is the step most likely to be got wrong and the step that
// silently "works" if you skip it on a lightweight tag.
import { createServer } from 'node:http';
import { checkMarketplace } from '../check-federated-content.mjs';

const SKILLS_VERIFIED = 'aaaa000000000000000000000000000000000000';
const SKILLS_MOVED = 'bbbb111111111111111111111111111111111111';

// repo -> the chain its v1.0.0 resolves through.
const repos = {
  'opum-ai/steady-cli': { tagObj: 'tag1', commit: 'commit1', rootTree: 'tree1', skills: SKILLS_VERIFIED },
  // Same tag name, same everything up to the tree - different skill content.
  'opum-ai/repointed-cli': { tagObj: 'tag2', commit: 'commit2', rootTree: 'tree2', skills: SKILLS_MOVED },
  // Lightweight tag: the ref points straight at the commit, no tag object.
  'opum-ai/light-cli': { commit: 'commit3', rootTree: 'tree3', skills: SKILLS_VERIFIED },
  // Resolves, but has no skills/ directory at its root.
  'opum-ai/noskills-cli': { tagObj: 'tag4', commit: 'commit4', rootTree: 'tree4', skills: null },
};

const server = createServer((req, res) => {
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  for (const [repo, c] of Object.entries(repos)) {
    if (req.url === `/repos/${repo}/git/ref/tags/v1.0.0`) {
      return send({ object: c.tagObj ? { type: 'tag', sha: c.tagObj } : { type: 'commit', sha: c.commit } });
    }
    if (c.tagObj && req.url === `/repos/${repo}/git/tags/${c.tagObj}`) {
      return send({ object: { type: 'commit', sha: c.commit } });
    }
    if (req.url === `/repos/${repo}/git/commits/${c.commit}`) {
      return send({ tree: { sha: c.rootTree } });
    }
    if (req.url === `/repos/${repo}/git/trees/${c.rootTree}`) {
      const tree = [{ path: 'src', type: 'tree', sha: 'cccc2222' }];
      if (c.skills) tree.push({ path: 'skills', type: 'tree', sha: c.skills });
      return send({ tree });
    }
  }
  res.writeHead(404);
  res.end();
});

let pass = 0;
let fail = 0;
const ok = (label) => {
  pass++;
  console.log(`  ok   ${label}`);
};
const bad = (label) => {
  fail++;
  console.log(`  FAIL ${label}`);
};

const entry = (name, repo) => ({ name, source: { source: 'github', repo, ref: 'v1.0.0' } });
const baselineFor = (name, ref = 'v1.0.0', skills = SKILLS_VERIFIED) => ({
  [name]: { ref, trees: { skills } },
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const api = `http://127.0.0.1:${port}`;

try {
  let problems = await checkMarketplace(
    { plugins: [entry('steady', 'opum-ai/steady-cli')] },
    baselineFor('steady'),
    api,
  );
  problems.length === 0
    ? ok('a tag still resolving to the verified skills subtree passes')
    : bad(`steady pin flagged: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace(
    { plugins: [entry('light', 'opum-ai/light-cli')] },
    baselineFor('light'),
    api,
  );
  problems.length === 0
    ? ok('a lightweight tag resolves without a tag object to peel')
    : bad(`lightweight tag mishandled: ${JSON.stringify(problems)}`);

  // The whole point of the guard.
  problems = await checkMarketplace(
    { plugins: [entry('repointed', 'opum-ai/repointed-cli')] },
    baselineFor('repointed'),
    api,
  );
  problems.length === 1 &&
  /repointed at different skills content/.test(problems[0]) &&
  problems[0].includes(SKILLS_MOVED) &&
  problems[0].includes(SKILLS_VERIFIED)
    ? ok('a tag repointed at different skill content is caught, naming both SHAs')
    : bad(`repointed tag not caught: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace(
    { plugins: [entry('steady', 'opum-ai/steady-cli')] },
    baselineFor('steady', 'v0.9.0'),
    api,
  );
  problems.length === 1 && /baseline is still for v0\.9\.0/.test(problems[0])
    ? ok('a pin bumped past its baseline fails instead of checking the wrong tag')
    : bad(`stale baseline not caught: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace({ plugins: [entry('steady', 'opum-ai/steady-cli')] }, {}, api);
  problems.length === 1 && /records no verified content/.test(problems[0])
    ? ok('a v-pin with no baseline at all fails, so a new entry cannot skip the check')
    : bad(`missing baseline not caught: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace(
    {
      plugins: [
        { name: 'branchpin', source: { source: 'github', repo: 'opum-ai/x', ref: 'main' } },
        { name: 'shaonly', source: { source: 'github', repo: 'opum-ai/x', sha: 'deadbeef' } },
        { name: 'local', source: './' },
      ],
    },
    {},
    api,
  );
  problems.length === 0
    ? ok('branch pins, sha pins and local sources are out of scope, not fetched')
    : bad(`unexpected problems: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace(
    { plugins: [entry('noskills', 'opum-ai/noskills-cli')] },
    baselineFor('noskills'),
    api,
  );
  problems.length === 1 && /has no skills\/ directory/.test(problems[0])
    ? ok('a tag that resolves but carries no skills/ fails, not passes silently')
    : bad(`missing skills dir: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace(
    { plugins: [entry('gone', 'opum-ai/deleted-cli')] },
    baselineFor('gone'),
    api,
  );
  problems.length === 1 && /HTTP 404/.test(problems[0])
    ? ok('an unresolvable tag fails, not passes silently')
    : bad(`unresolvable tag: ${JSON.stringify(problems)}`);
} finally {
  server.close();
}

console.log('');
console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
