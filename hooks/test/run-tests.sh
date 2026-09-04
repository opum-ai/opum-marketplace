#!/bin/sh
# Behavioural tests for the opum-workflow session hooks.
#
# Each test asserts one of OPAG-32's acceptance criteria, or one of the two
# defects these hooks were written to fix. No network, no real tracker: `quest`
# is stubbed on PATH so the parsing is exercised without a workspace.
set -u
HOOKS=$(cd "$(dirname "$0")/.." && pwd -P)
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

sandbox() {
  SB=$(mktemp -d); export SB
  git -C "$SB" init -q .
  git -C "$SB" config user.email t@t.invalid; git -C "$SB" config user.name T
  mkdir -p "$SB/.quest/tasks" "$SB/bin"
  echo "seed" > "$SB/README.md"
  git -C "$SB" add -A >/dev/null 2>&1; git -C "$SB" commit -qm seed
  cat > "$SB/bin/quest" <<'Q'
#!/bin/sh
case "$*" in
  *"task list"*) echo '{"data":{"tasks":[{"id":"OPRB-7","title":"stub"}]}}' ;;
  *"task view"*) echo "id: OPRB-7"; echo "title: stub task" ;;
  *"task edit"*) echo "$*" >> "${QUEST_EDIT_LOG:-/dev/null}" ;;
esac
exit 0
Q
  chmod +x "$SB/bin/quest"
  export PATH="$SB/bin:$PATH"
  export CLAUDE_PROJECT_DIR="$SB"
}
cleanup() { [ -n "${SB:-}" ] && rm -rf "$SB"; }

echo "AC3 - a read-and-reason session with no file edits still produces a usable handover"
sandbox
sh "$HOOKS/pre-compact.sh" >/dev/null 2>&1
check "exit 0" "$?" "0"
CUR="$SB/.claude/handover/cursor.md"
[ -f "$CUR" ] && ok "cursor written with zero edits made" || bad "no cursor written"
grep -q 'OPRB-7' "$CUR" 2>/dev/null && ok "cursor names the live task, not an edit checkpoint" || bad "task missing"
grep -q 'Branch:' "$CUR" 2>/dev/null && ok "cursor records live repository state" || bad "branch missing"
[ "$(wc -c < "$CUR" 2>/dev/null)" -gt 200 ] && ok "cursor is substantive, not an empty shell" || bad "cursor too small"
cleanup

echo "AC4 - SessionStart injects via hookSpecificOutput.additionalContext, not stdout"
sandbox
OUT=$(sh "$HOOKS/session-start.sh" 2>/dev/null)
check "exit 0" "$?" "0"
# printf, not echo: `echo` in sh expands the \n escapes inside the JSON string
# and breaks the document before jq ever sees it. That cost a false failure once.
printf '%s\n' "$OUT" | grep -q '"hookEventName"[[:space:]]*:[[:space:]]*"SessionStart"' && ok "emits hookEventName SessionStart" || bad "no hookEventName"
printf '%s\n' "$OUT" | grep -q '"additionalContext"' && ok "emits additionalContext" || bad "no additionalContext"
if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | length > 0' >/dev/null 2>&1 \
    && ok "output is valid JSON with a non-empty context" || bad "invalid JSON or empty context"
fi
cleanup

echo "Defect 1 - SessionStart must NOT delete the cursor it reads"
sandbox
mkdir -p "$SB/.claude/handover"; printf '# cursor\nprevious session state\n' > "$SB/.claude/handover/cursor.md"
sh "$HOOKS/session-start.sh" >/dev/null 2>&1
[ -f "$SB/.claude/handover/cursor.md" ] && ok "cursor survives being read" || bad "cursor was deleted (the lore-cli defect)"
sh "$HOOKS/session-start.sh" 2>/dev/null | grep -q 'previous session state' && ok "cursor contents are surfaced" || bad "cursor not surfaced"
cleanup

echo "AC2 - trust order: tracker and repository outrank the cursor"
sandbox
mkdir -p "$SB/.claude/handover"; printf 'stale cursor claim\n' > "$SB/.claude/handover/cursor.md"
OUT=$(sh "$HOOKS/session-start.sh" 2>/dev/null)
T=$(printf '%s\n' "$OUT" | grep -o 'Tracker (live)' | head -1)
[ -n "$T" ] && ok "tracker section present" || bad "no tracker section"
POS_TRACKER=$(printf '%s\n' "$OUT" | grep -bo 'Tracker (live)' | head -1 | cut -d: -f1)
POS_CURSOR=$(printf '%s\n' "$OUT" | grep -bo 'Restart cursor' | head -1 | cut -d: -f1)
if [ -n "$POS_TRACKER" ] && [ -n "$POS_CURSOR" ] && [ "$POS_TRACKER" -lt "$POS_CURSOR" ]; then
  ok "tracker is presented before the cursor"
else bad "ordering wrong (tracker=$POS_TRACKER cursor=$POS_CURSOR)"; fi
printf '%s\n' "$OUT" | grep -q 'NOT authoritative' && ok "cursor is labelled non-authoritative" || bad "cursor not labelled"
cleanup

echo "AC1 - tracker is written before the cursor, and every failure path exits 0"
sandbox
export QUEST_EDIT_LOG="$SB/edits.log"
OPUM_HOOK_ACTOR=test-actor OPUM_HOOK_ACCOUNTABLE_HUMAN=test-human sh "$HOOKS/pre-compact.sh" >/dev/null 2>&1
grep -q 'task edit' "$SB/edits.log" 2>/dev/null && ok "tracker note written when actor is declared" || bad "no tracker write"
grep -q 'actor-kind delegated-agent' "$SB/edits.log" 2>/dev/null && ok "declares delegated-agent, never human" || bad "wrong actor-kind"
unset QUEST_EDIT_LOG
cleanup

echo "AC1 - failure paths"
sandbox
rm -rf "$SB/.git"                                  # no git
sh "$HOOKS/pre-compact.sh"  >/dev/null 2>&1; check "no git repo    -> exit 0" "$?" "0"
sh "$HOOKS/session-start.sh" >/dev/null 2>&1; check "no git repo    -> exit 0" "$?" "0"
cleanup
sandbox
rm -rf "$SB/.quest" "$SB/bin/quest"                # no tracker
sh "$HOOKS/pre-compact.sh"  >/dev/null 2>&1; check "no tracker     -> exit 0" "$?" "0"
sh "$HOOKS/session-start.sh" >/dev/null 2>&1; check "no tracker     -> exit 0" "$?" "0"
cleanup
sandbox
chmod 500 "$SB"                                    # unwritable project dir
sh "$HOOKS/pre-compact.sh"  >/dev/null 2>&1; check "unwritable dir -> exit 0" "$?" "0"
chmod 700 "$SB"; cleanup
CLAUDE_PROJECT_DIR=/nonexistent-path-xyz sh "$HOOKS/pre-compact.sh"  >/dev/null 2>&1; check "missing dir    -> exit 0" "$?" "0"
CLAUDE_PROJECT_DIR=/nonexistent-path-xyz sh "$HOOKS/session-start.sh" >/dev/null 2>&1; check "missing dir    -> exit 0" "$?" "0"
sh "$HOOKS/session-end.sh" >/dev/null 2>&1; check "session-end     -> exit 0" "$?" "0"

echo "Ported hooks - allowlist fires in workers only, and survives a symlinked root"
FT=$(mktemp -d)
mkdir -p "$FT/repos/lore-cli" "$FT/repos/opum-agent" "$FT/elsewhere" "$FT/home"
mkdir -p "$FT/link"; ln -s "$FT/repos" "$FT/link/repos" 2>/dev/null
runrc() { ( cd "$1" && HOME="$FT/home" OPUM_FLEET_ROOT="$2" sh "$HOOKS/report-completion.sh" </dev/null >/dev/null 2>&1; echo $?; ); }
check "worker       -> exit 0" "$(runrc "$FT/repos/lore-cli" "$FT/repos")" "0"
check "orchestrator -> exit 0" "$(runrc "$FT/repos/opum-agent" "$FT/repos")" "0"
check "unrelated    -> exit 0" "$(runrc "$FT/elsewhere" "$FT/repos")" "0"
FLOG="$FT/home/.local/state/opum-fleet/worker-completions.jsonl"
check "only the worker logged" "$( [ -f "$FLOG" ] && wc -l < "$FLOG" | tr -d ' ' || echo 0)" "1"
grep -q '"repo":"lore-cli"' "$FLOG" 2>/dev/null && ok "logged repo is the worker" || bad "wrong repo logged"
# The root given in symlink form must still match. Comparing a resolved cwd
# against an unresolved root is the defect that shipped once already.
rm -f "$FLOG"
runrc "$FT/repos/lore-cli" "$FT/link/repos" >/dev/null
check "symlinked fleet root still matches" "$( [ -f "$FLOG" ] && wc -l < "$FLOG" | tr -d ' ' || echo 0)" "1"
# ORCHESTRATOR_CWD must be derived AFTER the root is resolved.
ORC=$(sed -n '/^ORCHESTRATOR_CWD=/=' "$HOOKS/notify-orchestrator.sh" | head -1)
ROOT=$(sed -n '/^OPUM_FLEET_ROOT=/=' "$HOOKS/notify-orchestrator.sh" | head -1)
if [ -n "$ORC" ] && [ -n "$ROOT" ] && [ "$ROOT" -lt "$ORC" ]; then
  ok "ORCHESTRATOR_CWD is derived after the fleet root is set"
else bad "ORCHESTRATOR_CWD line $ORC precedes root line $ROOT"; fi
rm -rf "$FT"

echo ""
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
