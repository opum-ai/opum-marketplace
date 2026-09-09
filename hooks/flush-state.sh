#!/bin/sh
# Shared body for PreCompact and SessionEnd: flush what this session knows
# before the context holding it goes away.
#
# Fixes the defect in the lore-cli hook this replaces
# (.claude/hooks/pre-compact.sh): that hook built the handover from `.checkpoint`,
# a file written ONLY by a PostToolUse hook matching Edit|Write. A session that
# read, searched, reasoned and decided - without editing a file - produced a
# handover containing nothing at all. That is precisely the session whose state
# is hardest to reconstruct and most worth keeping.
#
# This derives state from sources that exist regardless of whether anything was
# edited: the live tracker, and the live repository.
#
# ORDER MATTERS. The tracker is written BEFORE the cursor. The cursor is a file
# in a working tree that may be discarded, on a machine that may be rebuilt; the
# tracker is committed and survives both. If only one of the two writes lands,
# it must be the durable one.
#
# OMARK-23: that durability guarantee does not mean the note belongs on every
# firing. The cursor step below is unconditional and already fully carries the
# live-derived state that fixes the defect above; it costs nothing because
# .claude/handovers/ is gitignored fleet-wide (excluding a gap this same
# change closes in opum-marketplace, its own eighth-repo omission). The
# tracker note has no gitignore to hide behind - .quest/ is committed - so an
# unconditional write there dirties the tree on every SessionEnd/PreCompact,
# which under opum-sdlc needs a branch and a PR to land, which ends a session,
# which fires the hook again. Observed running: lore-web's last five PRs
# before this fix were nothing but that note landing on itself, five times in
# a row, three of them onto a task (LWEB-55) the ending session had not
# touched - it was simply the sole task left In Progress. The guard below
# breaks the loop at its source: skip the write when there is nothing
# uncommitted or unpushed for it to protect, because in that state the note's
# own write would be the only reason the tree needed a PR at all.
. "$(dirname "$0")/_lib.sh"

REASON="${1:-flush}"
PROJECT_DIR=$(opum_project_dir)
CURSOR=$(opum_cursor_path)
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

BRANCH=$(opum_git rev-parse --abbrev-ref HEAD)
DIRTY_LIST=$(opum_git status --porcelain | head -20)
DIRTY=$(opum_git status --porcelain | wc -l | tr -d ' ')
RECENT=$(opum_git log --oneline -5)
UNPUSHED=$(opum_git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "")
ACTIVE=$(opum_active_task 2>/dev/null || true)

# --- 1. Tracker first, and only when it is unambiguous and there is ------
# ---    something uncommitted or unpushed for the note to protect --------
#
# A note is appended only when exactly one task is In Progress. Guessing which
# of several a session was on would put a false record somewhere durable, and a
# wrong durable record is worse than none - it is the thing a later session
# trusts over its own reading.
#
# It is also appended only when the repository has something at risk of being
# lost: an uncommitted file or an unpushed commit. A clean tree with nothing
# unpushed has nothing this note would preserve that live git and the tracker
# do not already show, and writing it anyway is exactly what makes the note
# the sole reason the tree needs a commit - see OMARK-23 above. This guard
# never touches the cursor step below, which stays unconditional; a session
# that read, reasoned and decided without editing a file still gets a full
# live-state cursor either way, just no redundant tracker duplicate of it.
case "$ACTIVE" in
  '' | *' '*) : ;;
  *)
    if [ "$DIRTY" = "0" ] && { [ -z "$UNPUSHED" ] || [ "$UNPUSHED" = "0" ]; }; then
      :
    elif [ -n "${OPUM_HOOK_ACTOR:-}" ] && [ -n "${OPUM_HOOK_ACCOUNTABLE_HUMAN:-}" ]; then
      NOTE="Session ${REASON} at ${STAMP}. Branch ${BRANCH:-unknown}, ${DIRTY} uncommitted file(s)$( [ -n "$UNPUSHED" ] && [ "$UNPUSHED" != "0" ] && printf ', %s unpushed commit(s)' "$UNPUSHED" ). Written by the opum-workflow ${REASON} hook, not by the model."
      quest task edit "$ACTIVE" --add-note "$NOTE" \
        --actor "$OPUM_HOOK_ACTOR" \
        --actor-kind delegated-agent \
        --accountable-human "$OPUM_HOOK_ACCOUNTABLE_HUMAN" >/dev/null 2>&1 || true
    fi
    ;;
esac

# --- 2. Cursor second ------------------------------------------------------
mkdir -p "$(dirname "$CURSOR")" 2>/dev/null || true
{
  echo "# Restart cursor - ${REASON}, ${STAMP}"
  echo ""
  echo "Written by the opum-workflow ${REASON} hook. **Not authoritative**: the live"
  echo "tracker and the live repository outrank it. Read it to restart faster, not to"
  echo "decide what is true."
  echo ""
  case "$ACTIVE" in
    '')      echo "## Task"; echo ""; echo "Nothing was In Progress in the tracker." ;;
    *' '*)   echo "## Task"; echo ""; echo "Ambiguous - In Progress: ${ACTIVE}. No tracker note was written." ;;
    *)       echo "## Task"; echo ""; echo "In Progress: ${ACTIVE}" ;;
  esac
  echo ""
  echo "## Repository"
  echo ""
  echo "- Branch: ${BRANCH:-unknown}"
  echo "- Uncommitted files: ${DIRTY}"
  [ -n "$UNPUSHED" ] && [ "$UNPUSHED" != "0" ] && echo "- Unpushed commits: ${UNPUSHED}"
  if [ -n "$DIRTY_LIST" ]; then
    echo ""
    echo "### Uncommitted"
    echo ""
    echo '```'
    echo "$DIRTY_LIST"
    echo '```'
  fi
  if [ -n "$RECENT" ]; then
    echo ""
    echo "### Recent commits"
    echo ""
    echo '```'
    echo "$RECENT"
    echo '```'
  fi
} > "$CURSOR" 2>/dev/null || true

exit 0
