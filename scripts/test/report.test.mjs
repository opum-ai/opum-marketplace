#!/usr/bin/env node
// OMARK-57. Covers what the other two suites cannot reach: the CLI main block,
// where each checker composes its SUCCESS MESSAGE. Both assertions were already
// extracted and tested; the message was not, and the message was the half that
// lied - check-federated-pins printed market.plugins.length ("3 plugin(s)
// checked") while only ever checking v-prefixed tag pins, and
// check-federated-content named the BASELINES FILE'S KEYS as verified on runs
// that resolved none of them.
//
// These run each script as a subprocess against a fixture working directory and
// assert the emitted text, not just the exit code. A green exit says nothing
// about what the run claimed to have measured.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS = resolve(import.meta.dirname, '..');

// plugin.json for the pin checker; git-database shapes for the content checker.
const raw = {
  '/opum-ai/good-cli/v1.2.3/.claude-plugin/plugin.json': { version: '1.2.3' },
};
const api = {
  '/repos/opum-ai/good-cli/git/ref/tags/v1.2.3': { object: { sha: 'commit1', type: 'commit' } },
  '/repos/opum-ai/good-cli/git/commits/commit1': { tree: { sha: 'root1' } },
  '/repos/opum-ai/good-cli/git/trees/root1': { tree: [{ path: 'skills', type: 'tree', sha: 'skills1' }] },
};
const serve = (table) =>
  createServer((req, res) => {
    const body = table[req.url];
    if (body === undefined) return void (res.writeHead(404), res.end());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });

let pass = 0;
let fail = 0;
const ok = (l) => (pass++, console.log(`  ok   ${l}`));
const bad = (l, d) => (fail++, console.log(`  FAIL ${l}\n       ${d}`));

const rawServer = serve(raw);
const apiServer = serve(api);
await new Promise((r) => rawServer.listen(0, r));
await new Promise((r) => apiServer.listen(0, r));
const RAW = `http://127.0.0.1:${rawServer.address().port}`;
const API = `http://127.0.0.1:${apiServer.address().port}`;

// Builds a fixture working directory and runs one checker in it.
// ASYNC on purpose: the fixture HTTP servers live in THIS process, so a
// synchronous execFileSync would block the event loop that has to answer the
// child's fetch, and the run would deadlock rather than fail.
async function run(script, plugins, baselines = {}) {
  // realpath, deliberately: on macOS tmpdir() is /var/... while import.meta.url
  // resolves to /private/var/..., so the scripts' `import.meta.url ===
  // file://${process.argv[1]}` guard would be false and the CLI block - the
  // thing under test - would silently not run, passing with empty output.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'omark57-')));
  mkdirSync(join(dir, '.claude-plugin'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, '.claude-plugin/marketplace.json'), JSON.stringify({ plugins }));
  writeFileSync(join(dir, 'scripts/federated-pin-baselines.json'), JSON.stringify(baselines));
  cpSync(join(SCRIPTS, script), join(dir, 'scripts', script));
  if (script === 'check-federated-content.mjs') {
    cpSync(join(SCRIPTS, 'check-federated-pins.mjs'), join(dir, 'scripts/check-federated-pins.mjs'));
  }
  const opts = {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FEDERATED_PIN_RAW_BASE: RAW, FEDERATED_CONTENT_API_BASE: API },
  };
  try {
    const { stdout } = await execFileAsync('node', [join(dir, 'scripts', script)], opts);
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const tagPin = { name: 'good', source: { source: 'github', repo: 'opum-ai/good-cli', ref: 'v1.2.3' } };
const branchPin = { name: 'styles', source: { source: 'github', repo: 'opum-ai/styles', ref: 'main' } };
const droppedV = { name: 'good', source: { source: 'github', repo: 'opum-ai/good-cli', ref: '1.2.3' } };
const baseline = { good: { ref: 'v1.2.3', trees: { skills: 'skills1' } } };

try {
  // --- pin checker -------------------------------------------------------
  let r = await run('check-federated-pins.mjs', [tagPin, branchPin]);
  r.code === 0 && /DELIBERATE-VIOLATION-OMARK-57/.test(r.out)
    ? ok('pins: counts what it checked, not how many entries exist')
    : bad('pins: mixed index miscounted', JSON.stringify(r));

  /out of scope: styles - ref "main" is not a release tag/.test(r.out)
    ? ok('pins: names the skipped entry and why')
    : bad('pins: skipped entry not named', JSON.stringify(r));

  r = await run('check-federated-pins.mjs', [branchPin]);
  r.code === 0 && /NOTHING WAS CHECKED/.test(r.out) && !/OK/.test(r.out)
    ? ok('pins: an all-out-of-scope index does not report OK')
    : bad('pins: all-skipped run claimed success', JSON.stringify(r));

  r = await run('check-federated-pins.mjs', [droppedV]);
  r.code === 1 && /version-shaped but has no leading "v"/.test(r.out)
    ? ok('pins: a version-shaped ref missing its "v" fails instead of silently skipping')
    : bad('pins: dropped-v not caught', JSON.stringify(r));

  // --- content checker ---------------------------------------------------
  r = await run('check-federated-content.mjs', [tagPin, branchPin], baseline);
  r.code === 0 && /1 of 2 entries resolved and matched their baseline: good/.test(r.out)
    ? ok('content: reports what it resolved, not the baselines file keys')
    : bad('content: mixed index misreported', JSON.stringify(r));

  r = await run('check-federated-content.mjs', [droppedV], baseline);
  r.code === 1 && /version-shaped but has no leading "v"/.test(r.out)
    ? ok('content: dropped-v fails rather than reporting the baseline as verified')
    : bad('content: dropped-v reported as verified', JSON.stringify(r));

  r = await run('check-federated-content.mjs', [branchPin], baseline);
  r.code === 0 && /NOTHING WAS RESOLVED/.test(r.out) && !/verified/.test(r.out.split('note:')[0] ?? '')
    ? ok('content: resolving nothing does not report the baseline as verified')
    : bad('content: empty run claimed verification', JSON.stringify(r));

  /note: baseline recorded for "good" but no in-scope entry/.test(r.out)
    ? ok('content: an unreferenced baseline is noted, not counted')
    : bad('content: orphan baseline silently absorbed', JSON.stringify(r));
} finally {
  rawServer.close();
  apiServer.close();
}

console.log(`\npassed ${pass}, failed ${fail}`);
process.exit(fail ? 1 : 0);
