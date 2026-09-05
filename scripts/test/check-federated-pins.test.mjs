#!/usr/bin/env node
// Regression test for ../check-federated-pins.mjs. Proves the guard actually
// fails on the v0.4.3-shaped defect (ref names one version, plugin.json
// declares another) and passes when they agree - a guard that cannot fail
// has the shape of a gate without the effect. No network: serves fixtures
// from a local server and points the checker at it via FEDERATED_PIN_RAW_BASE.
import { createServer } from 'node:http';
import { checkMarketplace } from '../check-federated-pins.mjs';

const fixtures = {
  '/opum-ai/good-cli/v1.2.3/.claude-plugin/plugin.json': { version: '1.2.3' },
  // The real defect's shape: the tag is v0.4.3 but plugin.json never moved off 0.4.2.
  '/opum-ai/stale-cli/v0.4.3/.claude-plugin/plugin.json': { version: '0.4.2' },
  '/opum-ai/broken-cli/v1.0.0/.claude-plugin/plugin.json': 'not json',
};

const server = createServer((req, res) => {
  const body = fixtures[req.url];
  if (body === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
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

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
process.env.FEDERATED_PIN_RAW_BASE = `http://127.0.0.1:${port}`;

try {
  let problems = await checkMarketplace({
    plugins: [{ name: 'good', source: { source: 'github', repo: 'opum-ai/good-cli', ref: 'v1.2.3' } }],
  });
  problems.length === 0
    ? ok('a pin matching its plugin.json version passes')
    : bad(`good pin flagged: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace({
    plugins: [{ name: 'stale', source: { source: 'github', repo: 'opum-ai/stale-cli', ref: 'v0.4.3' } }],
  });
  problems.length === 1 && /pinned to v0.4.3 but its plugin.json version is "0.4.2"/.test(problems[0])
    ? ok('a stale plugin.json (the real v0.4.3 defect) is caught')
    : bad(`stale pin not caught: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace({
    plugins: [
      { name: 'local', source: './' },
      { name: 'shaonly', source: { source: 'github', repo: 'opum-ai/x', sha: 'deadbeef' } },
    ],
  });
  problems.length === 0
    ? ok('local and sha-only sources are skipped, not fetched')
    : bad(`unexpected problems: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace({
    plugins: [{ name: 'missing', source: { source: 'github', repo: 'opum-ai/nope', ref: 'v9.9.9' } }],
  });
  problems.length === 1 && /HTTP 404/.test(problems[0])
    ? ok('an unfetchable pin fails, not passes silently')
    : bad(`unfetchable pin: ${JSON.stringify(problems)}`);

  problems = await checkMarketplace({
    plugins: [{ name: 'broken', source: { source: 'github', repo: 'opum-ai/broken-cli', ref: 'v1.0.0' } }],
  });
  problems.length === 1 && /not valid JSON/.test(problems[0])
    ? ok('invalid JSON at the ref fails, not passes silently')
    : bad(`invalid JSON case: ${JSON.stringify(problems)}`);
} finally {
  server.close();
}

console.log('');
console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
