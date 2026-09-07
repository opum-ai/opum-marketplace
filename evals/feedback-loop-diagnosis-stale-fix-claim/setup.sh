#!/usr/bin/env bash
# Seeds a repo where a tracker task claims a bug is fixed, and it partly is:
# the retry wrapper it added exists and works for HTTP-level failures, but its
# retryability check only reads err.status, and the specific error this ticket
# reports (a raw socket-level ECONNRESET, which carries err.code and no
# status) never satisfies it. The captured log already proves the retry never
# fired ("giving up after 1 attempt"). Nothing here needs to be run — the gap
# is visible by reading the guard condition against the log's error shape.
set -euo pipefail

git init -q .
git config user.email "eval@opum.invalid"
git config user.name "Opum Eval"

mkdir -p .quest/tasks src logs

cat > .quest/workspace.toml <<'INNER'
schemaVersion = 1
taskIdPrefix = "OPS"
INNER

cat > .quest/tasks/OPS-1.json <<'INNER'
{"id":"OPS-1","title":"Retry uploadReport on transient connection failures","status":"Done","type":"fix","priority":"High","finalSummary":"Added a retry wrapper around uploadReport. Retries transient failures - connection resets and 5xx responses - up to 4 times with backoff. Landed as #212.","updatedAt":"2026-08-02T10:00:00.000Z"}
INNER

cat > src/upload.js <<'INNER'
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function isRetryable(err) {
  const status = err.response?.status ?? err.status;
  return status !== undefined && RETRYABLE_STATUS.has(status);
}

async function uploadReport(client, report, { attempts = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await client.post('/reports', report);
      if (res.status !== 200) throw new Error(`upload failed: ${res.status}`);
      return res.data.id;
    } catch (err) {
      lastErr = err;
      console.error(`[upload] attempt ${attempt} failed`);
      if (attempt === attempts || !isRetryable(err)) {
        console.error(`[upload] giving up after ${attempt} attempt${attempt > 1 ? 's' : ''}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

module.exports = { uploadReport, isRetryable };
INNER

cat > logs/incident-2026-09-05.txt <<'INNER'
2026-09-05T02:14:07.298Z [upload] attempt 1 failed
Error: socket hang up
    at TLSSocket.socketOnEnd (node:_http_client:535:9)
    at TLSSocket.emit (node:events:530:35)
    at endReadableNT (node:internal/streams/readable:1400:12)
  code: 'ECONNRESET',
  errno: -54,
  syscall: 'read'
2026-09-05T02:14:07.301Z [upload] giving up after 1 attempt
INNER

git add -A
git commit -qm "Upload client, its retry wrapper, and one captured incident"
