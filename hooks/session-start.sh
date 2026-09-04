#!/bin/sh
# SessionStart: restore where the last session got to.
#
# Fixes two defects in the lore-cli hook this replaces
# (.claude/hooks/context-recovery.sh):
#
#   1. That hook did `rm -f "$CHECKPOINT_FILE"` immediately after displaying the
#      checkpoint. If the session then died, was interrupted, or simply never
#      acted on what it read, the state was gone permanently - and the one time
#      you most need a restart cursor is the time the previous session ended
#      badly. This hook NEVER deletes the cursor. The cursor is disposable, but
#      disposing of it is the next session's decision, not the reader's.
#
#   2. That hook wrote to stdout. stdout from SessionStart is transcript noise,
#      not injected context. This emits hookSpecificOutput.additionalContext,
#      which is the supported channel.
#
# TRUST ORDER, and it is the whole point of the hook:
#   1. live tracker (Quest) and live repository facts
#   2. the campaign document
#   3. the cursor, as restart acceleration ONLY
# The cursor is never authoritative. It is read last and labelled as stale by
# construction, because a cursor describes what a session INTENDED and the
# tracker describes what actually landed.
. "$(dirname "$0")/_lib.sh"

PROJECT_DIR=$(opum_project_dir)
CURSOR=$(opum_cursor_path)
OUT=""

emit() { OUT="${OUT}${1}
"; }

# --- 1. Live tracker -------------------------------------------------------
if opum_has_quest; then
  ACTIVE=$(opum_active_task || true)
  case "$ACTIVE" in
    '')  emit "## Tracker (live)"; emit ""; emit "No task is In Progress." ;;
    *' '*)
      emit "## Tracker (live)"; emit ""
      emit "More than one task is In Progress: ${ACTIVE}."
      emit "Ambiguous - confirm which one you are on before writing to either."
      ;;
    *)
      emit "## Tracker (live)"; emit ""
      emit "In Progress: ${ACTIVE}"
      DETAIL=$(quest task view "$ACTIVE" --plain 2>/dev/null | sed -n '1,40p')
      [ -n "$DETAIL" ] && { emit ""; emit '```'; emit "$DETAIL"; emit '```'; }
      ;;
  esac
  emit ""
fi

# --- 2. Live repository ----------------------------------------------------
BRANCH=$(opum_git rev-parse --abbrev-ref HEAD)
if [ -n "$BRANCH" ]; then
  emit "## Repository (live)"; emit ""
  emit "Branch: ${BRANCH}"
  DIRTY=$(opum_git status --porcelain | wc -l | tr -d ' ')
  emit "Uncommitted changes: ${DIRTY}"
  UNPUSHED=$(opum_git rev-list --count '@{u}..HEAD' 2>/dev/null)
  [ -n "$UNPUSHED" ] && [ "$UNPUSHED" != "0" ] && emit "Unpushed commits: ${UNPUSHED}"
  RECENT=$(opum_git log --oneline -3)
  [ -n "$RECENT" ] && { emit ""; emit '```'; emit "$RECENT"; emit '```'; }
  emit ""
fi

# --- 3. Cursor, last and lowest ------------------------------------------
if [ -f "$CURSOR" ]; then
  emit "## Restart cursor (NOT authoritative)"; emit ""
  emit "Written by a previous session before it compacted or ended. It records what"
  emit "that session INTENDED. Where it disagrees with the tracker or the repository"
  emit "above, they win. Verify before acting on it."
  emit ""
  emit "$(cat "$CURSOR" 2>/dev/null)"
  emit ""
  emit "_The cursor is left in place deliberately. Delete it yourself once its"
  emit "contents are either done or superseded._"
fi

[ -n "$OUT" ] && opum_emit_session_context "$OUT"
exit 0
