#!/bin/sh
# Shared helpers for the opum-workflow session hooks.
#
# CONTRACT, inherited from the hooks this replaces and non-negotiable: a hook
# must never break the session it is attached to. Every path here exits 0 or
# returns cleanly. A hook that can block a session is worse than the silence it
# replaces.
set -u

# $CLAUDE_PROJECT_DIR is set by the harness. Fall back to the working directory
# so the scripts stay testable from a shell.
opum_project_dir() {
  printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}"
}

# Resolve symlinks. /Users/jdnewhouse/repos is a symlink to
# /Volumes/external/repos, so a path compared in its logical form silently fails
# to match one written in its real form. Match on the resolved path, never $PWD.
opum_real_path() {
  _p="${1:-}"
  [ -d "$_p" ] || { printf '%s' "$_p"; return 0; }
  ( cd "$_p" 2>/dev/null && pwd -P ) || printf '%s' "$_p"
}

opum_cursor_path() {
  printf '%s/.claude/handover/cursor.md' "$(opum_project_dir)"
}

opum_has_quest() {
  [ -d "$(opum_project_dir)/.quest" ] && command -v quest >/dev/null 2>&1
}

# The single In Progress task, if there is exactly one. Ambiguity is not
# resolved by guessing: two in-progress tasks means the hook records nothing to
# the tracker and says so in the cursor instead.
opum_active_task() {
  opum_has_quest || return 1
  quest task list --status "In Progress" --json 2>/dev/null \
    | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([A-Z][A-Z0-9]*-[0-9][0-9.]*\)".*/\1/p' \
    | sort -u | head -2 | tr '\n' ' ' | sed 's/ $//'
}

opum_git() {
  git -C "$(opum_project_dir)" "$@" 2>/dev/null
}

# Emit SessionStart context the way the harness expects it.
#
# stdout from a SessionStart hook is NOT injected as context - it is surfaced as
# transcript noise. The additionalContext field is the supported channel, and it
# is the difference between a resumed session that knows where it was and one
# that merely printed something at the user.
opum_emit_session_context() {
  _body="$1"
  [ -n "$_body" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$_body" | jq -Rs '{
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: .
      }
    }'
  else
    # jq is not guaranteed. Escape by hand rather than emit invalid JSON, which
    # the harness would discard silently - the exact failure mode this hook is
    # meant to remove.
    _esc=$(printf '%s' "$_body" \
      | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
      | awk 'BEGIN{ORS=""} {print (NR>1 ? "\\n" : "") $0}')
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$_esc"
  fi
}
