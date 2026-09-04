#!/bin/sh
# Tell the orchestrator when this session blocks or goes idle, from the harness
# rather than from the model.
#
# Installed as a Claude Code `Notification` hook in each WORKER repository. The
# fleet operating model requires a session to message the orchestrator before it
# stops or blocks. That is a rule the model can forget, and on 2026-08-31 one did:
# opum-doc sat on a dialog while the orchestrator reported it as "standing by",
# and the user noticed before the fleet did. A hook cannot forget, because the
# model is not involved in running it.
#
# Deliberately NOT a `Stop` hook. Stop fires at the end of every turn, which is
# noise, and blocking a stop with exit 2 to force a report risks a loop when the
# thing being reported is itself the reason the turn ended. `Notification` fires
# exactly on the states that matter: permission_prompt, idle_prompt,
# agent_needs_input.
#
# WHERE TO INSTALL IT, and this is not a style preference.
#   PRIVATE repos (opum-doc, opum-cli-e2e) -> committed `.claude/settings.json`.
#     Fleet infrastructure should be reviewable.
#   PUBLIC repos (lore-cli, quest-cli)     -> `.claude/settings.local.json`,
#     which is gitignored and machine-scoped.
# The hook command hardcodes an absolute path on one machine. Committing that to
# a public repo leaks fleet-internal infrastructure into public history AND
# breaks every external contributor who opens the repo in Claude Code, who gets a
# hook-command-failure on every matching event. quest-cli's session caught this
# after the original instruction said "commit it, it is fleet infrastructure" --
# an instruction written without checking which repos are public, by someone who
# had already looked that up. Check visibility before installing:
#   gh api repos/opum-ai/<repo> --jq .visibility
#
# CONTRACT: never break the session it is attached to. Every failure path exits 0.
# A hook that can block a worker is worse than the silence it replaces.
set -u

LOG_DIR="${HOME}/.local/state/opum-fleet"
LOG="${LOG_DIR}/orchestrator-notifications.jsonl"

payload="$(cat 2>/dev/null || true)"

# Match on the RESOLVED path, never $PWD. $PWD is the logical path, and
# /Users/jdnewhouse/repos is a symlink to /Volumes/external/repos, so a session
# whose ambient cwd is the symlink form fails an allowlist written against the
# real form -- silently, which is precisely the failure this hook exists to
# prevent. opum-doc's session found this by piping a payload through from its own
# ambient cwd before installing; the author's testing missed it by cd-ing to the
# canonical path first.
#
# Fire ONLY from a known worker repository. An allowlist, not "anywhere except
# the orchestrator": the first test of this hook fired from /tmp and delivered a
# notification about a repo that does not exist. A hook that reports from
# anywhere teaches the orchestrator to ignore it, which is the same failure as
# not having one.
#
# PORTED for the plugin (OPAG-32). The allowlist used to be four absolute paths
# baked into a script living on one machine, which is why four repositories had
# to name that machine's path in their own settings. Both halves are now
# environment-overridable and default to the fleet's layout, so the same script
# works from ${CLAUDE_PLUGIN_ROOT} on any checkout.
OPUM_FLEET_ROOT="${OPUM_FLEET_ROOT:-/Volumes/external/repos}"
OPUM_FLEET_WORKERS="${OPUM_FLEET_WORKERS:-opum-doc lore-cli quest-cli opum-cli-e2e}"

# Resolve the fleet root too, not just the session's cwd. Comparing a resolved
# path against an unresolved one fails exactly as silently as comparing two
# unresolved ones - which is the bug the comment above describes, moved to the
# other operand. The original script escaped it only by hardcoding the real
# path; the moment the root became configurable, a root given in symlink form
# would have matched nothing and the hook would have gone quiet fleet-wide.
if [ -d "${OPUM_FLEET_ROOT}" ]; then
  OPUM_FLEET_ROOT="$(cd "${OPUM_FLEET_ROOT}" 2>/dev/null && pwd -P || printf '%s' "${OPUM_FLEET_ROOT}")"
fi

# Set AFTER the root is resolved. It used to sit near the top of the file, where
# it read OPUM_FLEET_ROOT before that variable existed and silently took the
# default - so overriding the root moved the workers but not the orchestrator,
# and the two halves disagreed about where the fleet lives.
ORCHESTRATOR_CWD="${OPUM_ORCHESTRATOR_CWD:-${OPUM_FLEET_ROOT}/opum-agent}"

resolved="$(pwd -P 2>/dev/null || printf '%s' "${PWD}")"

_match=0
for _w in ${OPUM_FLEET_WORKERS}; do
  case "${resolved}" in
    "${OPUM_FLEET_ROOT}/${_w}"|"${OPUM_FLEET_ROOT}/${_w}"/*) _match=1; break ;;
  esac
done
[ "${_match}" -eq 1 ] || exit 0

mkdir -p "${LOG_DIR}" 2>/dev/null || true

# The Notification input schema is not published, so record the raw payload
# verbatim on every fire. That is how the schema gets learned from real data
# instead of guessed, and it is the audit trail if a notification is ever missed.
printf '%s\n' "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"cwd\":\"${resolved}\",\"raw\":$(printf '%s' "${payload:-null}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf 'null')}" >>"${LOG}" 2>/dev/null || true

command -v herdr >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

repo="$(basename "${resolved}")"

# Pull whatever the payload offers without depending on a field being present.
detail="$(printf '%s' "${payload}" | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read() or "{}")
except Exception:
    raise SystemExit(0)
if not isinstance(d, dict):
    raise SystemExit(0)
# Field names are unverified against a published schema; try the plausible ones
# and fall back to saying so rather than inventing a reason.
kind = d.get("notification_type") or d.get("type") or d.get("matcher") or "unknown"
msg = d.get("message") or d.get("title") or d.get("body") or ""
# transcript_path is the only route to distinguishing a human DECISION from a
# plain end-of-turn idle; see the AskUserQuestion block below.
print(kind)
print(str(msg).replace("\n", " ")[:300])
print(d.get("transcript_path") or "")
' 2>/dev/null || true)"

kind="$(printf '%s\n' "${detail}" | sed -n '1p')"
msg="$(printf '%s\n' "${detail}" | sed -n '2p')"
transcript="$(printf '%s\n' "${detail}" | sed -n '3p')"
[ -n "${kind}" ] || kind="unknown"

# AskUserQuestion does NOT get its own notification_type. It arrives as
# `idle_prompt`, byte-identical to a session that simply finished its turn --
# measured on 2026-09-03 across 130 logged fires: 108 idle_prompt, 22
# permission_prompt, and not one type that means "a human decision is pending".
# So a worker asking its user a question was indistinguishable from a worker
# going quiet, and the orchestrator learned nothing. The only discriminator the
# payload offers is transcript_path, so read it: if the final assistant turn
# contains an AskUserQuestion tool call, this idle is a pending decision.
question=""
if [ "${kind}" = "idle_prompt" ] && [ -n "${transcript}" ] && [ -f "${transcript}" ]; then
  question="$(tail -n 200 "${transcript}" 2>/dev/null | python3 -c '
import json, sys
# An AskUserQuestion that has ALREADY been answered is not a pending decision.
# The first version of this check looked only for the last AskUserQuestion in the
# tail and fired on it, which reported lore-cli as blocked on a branch deletion it
# had already completed -- a false alarm on the very first production catch. A
# check that cries wolf teaches the orchestrator to ignore it, which is the same
# failure as having no check at all.
#
# The discriminator is the tool_use/tool_result pair: every answered question has a
# tool_result carrying its tool_use id. Scan the tail for both and report only ids
# with no answer. A question answered long ago falls out of the window entirely,
# which is the correct outcome; an answer can never precede its question, so the
# window can never hold an answer whose question it missed.
asked, answered = {}, set()
for line in sys.stdin:
    try:
        entry = json.loads(line)
    except Exception:
        continue
    message = entry.get("message")
    if not isinstance(message, dict):
        continue
    content = message.get("content")
    if not isinstance(content, list):
        continue
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_use" and block.get("name") == "AskUserQuestion":
            questions = (block.get("input") or {}).get("questions") or []
            headers = [q.get("header") or q.get("question", "")[:40] for q in questions if isinstance(q, dict)]
            asked[block.get("id")] = "; ".join(h for h in headers if h)[:200] or "unlabelled question"
        elif block.get("type") == "tool_result":
            answered.add(block.get("tool_use_id"))
pending = [text for uid, text in asked.items() if uid not in answered]
if pending:
    print(pending[-1])
' 2>/dev/null || true)"
  [ -n "${question}" ] && kind="human_decision"
fi

# TWO ROUTES, keyed on urgency rather than on event type. Both kinds are worth
# recording; only one is worth interrupting anyone over.
#
#   STUCK  -- permission_prompt, agent_needs_input, an elicitation dialog, or an
#             unknown kind. The session needs something and cannot proceed. Push
#             it to the orchestrator's pane.
#   STUCK also covers human_decision -- an idle_prompt whose final assistant turn
#             carries an AskUserQuestion. That is a worker waiting on a human and
#             it must never be filed as quiet.
#   QUIET  -- idle_prompt with no pending question. The session finished a turn. This
#             is the normal end of every piece of work in four repos, so pushing
#             it would make the alarm background noise -- which is how the silent
#             stall it was built to catch happened in the first place. Log only;
#             the orchestrator reads the log when it wants to know who has gone
#             quiet without reporting.
#
# Unknown kinds route to STUCK deliberately: the Notification schema is
# unpublished, and a silent drop is the exact failure this exists to prevent.
# Better a spurious interruption than a missed one.
case "${kind}" in
  idle_prompt) exit 0 ;;
  human_decision|permission_prompt|agent_needs_input|elicitation_dialog|elicitation_url_dialog|unknown) ;;
  *) exit 0 ;;
esac

pane="$(herdr agent list 2>/dev/null | python3 -c '
import json, sys
try:
    agents = json.load(sys.stdin)["result"]["agents"]
except Exception:
    raise SystemExit(0)
# Resolve by cwd, never a remembered pane id -- panes change every restart.
for a in agents:
    if a.get("cwd") == "'"${ORCHESTRATOR_CWD}"'":
        print(a.get("pane_id", ""))
        break
' 2>/dev/null || true)"

[ -n "${pane}" ] || exit 0

[ -n "${question}" ] && msg="asking its user about: ${question}"

herdr agent prompt "${pane}" "[auto] ${repo} is waiting: ${kind}. ${msg}

Sent by this repo's Notification hook, not by its session — the session may not know it is blocked and has NOT reported. Check it before assuming it is idle: herdr agent list, match on cwd, then herdr pane read <pane>." >/dev/null 2>&1 || true

exit 0
