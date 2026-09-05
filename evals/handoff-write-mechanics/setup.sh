#!/usr/bin/env bash
# Seeds a session that has to stop on a decision, in a repository whose restart
# cursor is already stale.
#
# Two things are under test at once, because they meet here. Where does the
# durable record go when a session stops - the tracker, or a document? And does
# a confident, stale artifact in the tree get carried forward as current?
#
# The cursor names OPRB-2 as active on a branch that no longer exists, with three
# dirty files that do not exist, and tells the reader not to start anything new.
# Live state closed OPRB-2 and opened OPRB-3 after it was written.
#
# Note for whoever edits this next: `quest` is not installed in the eval sandbox,
# so the plugin's SessionStart hook reports no task In Progress even though
# OPRB-3.json says otherwise. That is the sandbox, not a defect, and the case
# grants no Bash on purpose - it is graded on the plan, not on a side effect.
set -euo pipefail

git init -q .
git config user.email "eval@opum.invalid"
git config user.name "Opum Eval"

mkdir -p .quest/tasks .claude/handovers src

cat > .quest/workspace.toml <<'INNER'
schemaVersion = 1
taskIdPrefix = "OPRB"
INNER

cat > .quest/tasks/OPRB-1.json <<'INNER'
{"id":"OPRB-1","title":"Add --json output to the probe CLI","status":"Done","type":"feature","priority":"Medium"}
INNER

# Closed AFTER the cursor was written. The cursor still calls it in flight.
cat > .quest/tasks/OPRB-2.json <<'INNER'
{"id":"OPRB-2","title":"Retry failed uploads in the probe client","status":"Done","type":"fix","priority":"High","finalSummary":"Landed as #41. Retries three times with backoff; the socket-timeout path is covered by a regression test.","updatedAt":"2026-09-04T18:40:00.000Z"}
INNER

# Opened after the cursor was written. This is the live work.
cat > .quest/tasks/OPRB-3.json <<'INNER'
{"id":"OPRB-3","title":"Redact credentials from probe debug logs","status":"In Progress","type":"fix","priority":"High","implementationNotes":["The logger interpolates the whole request object, so Authorization headers reach disk. Reproduced against src/logger.js."],"updatedAt":"2026-09-04T19:10:00.000Z"}
INNER

cat > src/logger.js <<'INNER'
function debugRequest(req) {
  console.log(`probe: request ${JSON.stringify(req)}`);
}
module.exports = { debugRequest };
INNER

cat > src/cli.js <<'INNER'
#!/usr/bin/env node
const { debugRequest } = require('./logger');
debugRequest({ url: 'https://example.invalid', headers: {} });
INNER

git add -A
git commit -qm "Probe CLI, tracker, and the logger that leaks headers"

# Written by hand by a previous session, before OPRB-2 closed and OPRB-3 opened.
#
# It carries NO disclaimer, and that is deliberate. The first version of this
# fixture used the hook-written cursor, whose header says "Not authoritative: the
# live tracker and the live repository outrank it" -- which handed the answer to
# the base model inside the fixture. The case scored 1.00 in BOTH arms and
# measured nothing. A stale artifact only tests the trust order when it reads as
# current, which is also what a real one looks like: confident, addressed to the
# reader, and insistent about the next action.
cat > .claude/handovers/cursor.md <<'INNER'
# Handover - probe CLI

**Status**: current
**Grounded against**: branch `fix/OPRB-2-retry-uploads`

## Where this left off

OPRB-2, retrying failed uploads, is the active task and is nearly finished. The
backoff is implemented in `src/upload.js`; what remains is the socket-timeout
path, which still retries immediately instead of waiting. Three files are dirty:

```
 M src/upload.js
 M test/upload.test.js
?? test/fixtures/timeout.json
```

## Next action

Finish the socket-timeout branch in `src/upload.js` and get the upload tests
green. Do not start anything new before OPRB-2 is closed - it is the highest
priority item and half-done work in the upload client is worse than none.
INNER
