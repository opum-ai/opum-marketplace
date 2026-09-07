#!/usr/bin/env node
// Regression test for ../check-changelog-fold.mjs. Proves both halves of
// the guard actually fail on the shape they exist to catch - a guard that
// cannot fail has the shape of a gate without the effect (OPAG-51's lesson
// from the first pass at a structural check).
import { checkRelease, extractUnreleased } from '../check-changelog-fold.mjs';

let pass = 0;
let fail = 0;
const ok = (label) => {
  pass++;
  console.log(`  ok   ${label}`);
};
const bad = (label, detail) => {
  fail++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

const EMPTY_UNRELEASED = '# Changelog\n\n## Unreleased\n\n## 0.3.2\n\nSomething.\n';
const FILLED_UNRELEASED = '# Changelog\n\n## Unreleased\n\n- Added agents/.\n\n## 0.3.2\n\nSomething.\n';
const NO_UNRELEASED_HEADING = '# Changelog\n\n## 0.3.2\n\nSomething.\n';

// --- extractUnreleased itself ---
{
  const got = extractUnreleased(FILLED_UNRELEASED);
  got.includes('Added agents/')
    ? ok('extractUnreleased finds a real entry')
    : bad('extractUnreleased missed a real entry', got);
}
{
  const got = extractUnreleased(EMPTY_UNRELEASED);
  got === '' ? ok('extractUnreleased reads an empty section as empty') : bad('empty section not empty', JSON.stringify(got));
}
{
  const got = extractUnreleased(NO_UNRELEASED_HEADING);
  got === '' ? ok('extractUnreleased is empty when the heading is absent') : bad('missing heading not empty', JSON.stringify(got));
}

// --- content changed, version unchanged ---
{
  // The exact shape this guard exists for: OPAG-52 lands content with no
  // version bump, holding for a stacked release.
  const r = checkRelease({
    versionBefore: '0.3.2',
    versionAfter: '0.3.2',
    contentChanged: true,
    changelogText: FILLED_UNRELEASED,
  });
  r.ok ? ok('content changed + Unreleased documents it: passes') : bad('should have passed', r.reason);
}
{
  // The real OPAG-32 defect this guard was originally built to catch, still
  // caught: no version move AND nothing in Unreleased either.
  const r = checkRelease({
    versionBefore: '0.3.2',
    versionAfter: '0.3.2',
    contentChanged: true,
    changelogText: EMPTY_UNRELEASED,
  });
  !r.ok && /Unreleased section is empty/.test(r.reason)
    ? ok('content changed + empty Unreleased + no bump: fails')
    : bad('should have failed', r.reason);
}

// --- version moved ---
{
  // Wave 3's fold: three stacked entries land in ## 0.4.0, Unreleased is
  // cleared.
  const r = checkRelease({
    versionBefore: '0.3.2',
    versionAfter: '0.4.0',
    contentChanged: true,
    changelogText: EMPTY_UNRELEASED,
  });
  r.ok ? ok('version moved + Unreleased folded (empty): passes') : bad('should have passed', r.reason);
}
{
  // The new failure mode this guard adds: a version bump that leaves stale
  // Unreleased entries unfolded, which would silently carry them into the
  // NEXT release's notes too.
  const r = checkRelease({
    versionBefore: '0.3.2',
    versionAfter: '0.4.0',
    contentChanged: true,
    changelogText: FILLED_UNRELEASED,
  });
  !r.ok && /not empty/.test(r.reason)
    ? ok('version moved + Unreleased NOT folded: fails')
    : bad('should have failed', r.reason);
}

// --- nothing changed ---
{
  const r = checkRelease({
    versionBefore: '0.3.2',
    versionAfter: '0.3.2',
    contentChanged: false,
    changelogText: FILLED_UNRELEASED,
  });
  r.ok
    ? ok('no content change, version unchanged: passes regardless of Unreleased')
    : bad('should have passed', r.reason);
}

console.log('');
console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
