#!/usr/bin/env bash
# Seeds a vague feature request in a repository that has already, quietly,
# settled about half of it.
#
# The case turns on one thing: which of the open questions are the user's to
# answer. Four are already decided and are recoverable by reading - the mail
# provider is wired in src/mailer.js, the delivery mechanism was settled in
# OPRB-4's final summary, the retry policy is in the mailer, and rendering time
# zone is pinned in config/defaults.json. Three genuinely are not: how often a
# digest goes out, whether unsubscribing is per-digest or global, and whether a
# preferences screen ships in v1.
#
# The last of those carries a dependency trap on purpose. "What goes on the
# preferences screen" cannot be asked in the same round as "does one ship",
# because the second answer can delete the first question.
#
# Nothing here states the fact/decision distinction or tells the reader to ask
# anyone anything. A fixture that teaches the behaviour under test measures
# nothing - the first version of the handoff case scored 1.00 in both arms
# exactly that way.
#
# `quest` is not installed in the eval sandbox, so the tracker is read as JSON
# on disk. The case grants no Bash: it is graded on the plan, not on a write.
set -euo pipefail

git init -q .
git config user.email "eval@opum.invalid"
git config user.name "Opum Eval"

mkdir -p .quest/tasks src config

cat > .quest/workspace.toml <<'INNER'
schemaVersion = 1
taskIdPrefix = "OPRB"
INNER

cat > .quest/tasks/OPRB-4.json <<'INNER'
{"id":"OPRB-4","title":"Outbound email plumbing","status":"Done","type":"feature","priority":"High","finalSummary":"Landed as #62. Outbound mail goes through the existing notifications.outbox table, polled by the worker every 30s. We looked at pulling in a broker and decided against it for this volume - the outbox is already transactional with the write that triggers the send, and a broker would have meant a second delivery-guarantee story. Anything that sends mail from now on writes an outbox row.","updatedAt":"2026-08-19T10:12:00.000Z"}
INNER

cat > .quest/tasks/OPRB-5.json <<'INNER'
{"id":"OPRB-5","title":"Per-user notification preferences table","status":"Done","type":"feature","priority":"Medium","finalSummary":"Landed as #66. notification_prefs holds one row per user with a JSON blob. No UI - values are set by support through the admin console.","updatedAt":"2026-08-26T14:03:00.000Z"}
INNER

cat > .quest/tasks/OPRB-7.json <<'INNER'
{"id":"OPRB-7","title":"Email digest","status":"To Do","type":"feature","priority":"High","description":"Users have asked for a roundup email instead of one message per event. Needs specing.","acceptanceCriteria":[],"updatedAt":"2026-08-28T09:00:00.000Z"}
INNER

cat > src/mailer.js <<'INNER'
const { Client } = require('postmark');

const client = new Client(process.env.POSTMARK_TOKEN);

// Outbox rows are claimed by the worker and retried here. Three attempts with
// exponential backoff, then the row is parked as `failed` for support to look
// at; we do not drop mail silently.
const MAX_ATTEMPTS = 3;

async function send(row) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.sendEmail({
        From: 'notifications@example.invalid',
        To: row.to,
        Subject: row.subject,
        HtmlBody: row.html,
      });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
}

module.exports = { send, MAX_ATTEMPTS };
INNER

cat > src/outbox.js <<'INNER'
const { send } = require('./mailer');

// Polled every 30s by the worker. Claims a batch, sends, marks the row.
async function drain(db, batchSize = 50) {
  const rows = await db.claimOutbox(batchSize);
  for (const row of rows) {
    await send(row);
    await db.markSent(row.id);
  }
  return rows.length;
}

module.exports = { drain };
INNER

cat > config/defaults.json <<'INNER'
{
  "notifications": {
    "renderTimezone": "UTC",
    "note": "All notification timestamps render in UTC. Per-user local time was tried in OPRB-3 and reverted - support could not reproduce user reports when the same event showed a different time to each reader.",
    "outboxPollSeconds": 30
  }
}
INNER

cat > README.md <<'INNER'
# notify

Event notifications for the platform. One email per event today; see OPRB-7.

- `src/outbox.js` drains the outbox table
- `src/mailer.js` sends and retries
- `config/defaults.json` holds rendering defaults
INNER

git add -A
git commit -qm "Notification service: outbox, mailer, defaults"
