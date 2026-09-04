#!/bin/sh
# Record that a worker session finished a turn, from the harness.
#
# Installed as a Claude Code `Stop` hook in each WORKER repository. Companion to
# notify-orchestrator.sh, which handles the other half of the reporting duty.
#
# WHY A SEPARATE HOOK, AND WHY `Stop` RATHER THAN `idle_prompt`.
# The duty has two halves and they are not the same signal:
#   "I am stuck and need something"  -> Notification/permission_prompt. Urgent,
#      rare, worth interrupting the orchestrator. notify-orchestrator.sh pushes it.
#   "I finished"                     -> THIS hook. Routine, one per turn, worth
#      recording and not worth interrupting anyone over.
# `Stop` fires when Claude finishes responding -- the actual completion event.
# `idle_prompt` fires when the UI is waiting for input, which is adjacent but not
# the same: a session that ends a turn and is immediately given more work fires
# Stop and never idles. Reporting completion off a UI waiting state would miss
# exactly the sessions that are busiest.
#
# WHY IT DOES NOT BLOCK, though `Stop` is the one hook that can (exit 2 prevents
# stopping and continues the conversation). Blocking to force a session to report
# first would need a reliable way to detect whether it already had, and there is
# no such signal available to a shell hook -- inferring it from a transcript would
# be guesswork, and a wrong guess wedges a worker in a loop it cannot exit. The
# reporting here is deterministic WITHOUT blocking, because the harness does the
# reporting rather than asking the model to remember. Enforcement is a separate
# question and should only be reached for if silence recurs despite this.
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
# CONTRACT: never break the session it is attached to. Every failure path exits 0,
# and it never exits 2.
set -u

LOG_DIR="${HOME}/.local/state/opum-fleet"
LOG="${LOG_DIR}/worker-completions.jsonl"

payload="$(cat 2>/dev/null || true)"

# Resolved path, never $PWD: /Users/jdnewhouse/repos is a symlink to
# /Volumes/external/repos, and matching the logical path silently drops every
# session whose ambient cwd is the symlink form. That bug shipped once already in
# the companion hook and was caught by the session it would have excluded.
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

resolved="$(pwd -P 2>/dev/null || printf '%s' "${PWD}")"

_match=0
for _w in ${OPUM_FLEET_WORKERS}; do
  case "${resolved}" in
    "${OPUM_FLEET_ROOT}/${_w}"|"${OPUM_FLEET_ROOT}/${_w}"/*) _match=1; break ;;
  esac
done
[ "${_match}" -eq 1 ] || exit 0

mkdir -p "${LOG_DIR}" 2>/dev/null || true

# One line per completed turn. The orchestrator reads this to answer "who has
# finished and gone quiet without reporting" -- the failure that started all of
# this -- without being interrupted once per turn across four repos.
printf '%s\n' "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"repo\":\"$(basename "${resolved}")\",\"cwd\":\"${resolved}\",\"raw\":$(printf '%s' "${payload:-null}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf 'null')}" >>"${LOG}" 2>/dev/null || true

exit 0
