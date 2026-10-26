#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 3). Proof for scripts/ci/read-quest-version.sh.
#
# Both ways: the accepting case reads the real version from a valid block, and
# each rejecting case fails by NAME with an exact exit code. A rejection is
# asserted on the exact exit status AND on the message that names the cause, so
# silence or an unrelated crash cannot satisfy it (a negative assertion alone is
# satisfied by a producer that never spoke).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READER="$HERE/../ci/read-quest-version.sh"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok   $1"; }
no() { fail=$((fail+1)); echo "  FAIL $1"; echo "       exit=$2"; echo "$3" | sed 's/^/       | /'; }

BEGIN='<!-- quest:agent-instructions:begin -->'
END='<!-- quest:agent-instructions:end -->'

# check <label> <file> <want-exit> <must-contain>
check() {
  local out rc
  out="$(bash "$READER" "$2" 2>&1)"; rc=$?
  if [ "$rc" -ne "$3" ]; then no "$1" "$rc" "$out"; return; fi
  if ! printf '%s' "$out" | grep -qF -- "$4"; then no "$1 (exit ok, expected text missing: $4)" "$rc" "$out"; return; fi
  ok "$1"
}

block() { printf '%s\n## Quest\n\n%s\n%s\n' "$BEGIN" "$1" "$END"; }

# 1. valid block -> exact version on stdout, exit 0
block 'This project uses Quest CLI 0.14.1 for tracker operations. Run it.' > "$S/valid.md"
check 'valid block reads 0.14.1' "$S/valid.md" 0 '0.14.1'

# 2. the old read took the first match anywhere. A prose line OUTSIDE the block
#    declaring a different version must be ignored.
{ echo 'Notes: Quest CLI 9.9.9 for tracker operations (stale prose).'; block 'This project uses Quest CLI 0.14.1 for tracker operations.'; } > "$S/outside.md"
check 'prose outside the block is ignored' "$S/outside.md" 0 '0.14.1'
out="$(bash "$READER" "$S/outside.md" 2>/dev/null)"
[ "$out" = "0.14.1" ] && ok 'outside-prose case printed exactly 0.14.1' || no 'outside-prose case printed exactly 0.14.1' 0 "$out"

# 3. partial versions are refused by name
block 'This project uses Quest CLI 0.14 for tracker operations.' > "$S/partial.md"
check 'partial version 0.14 fails by name' "$S/partial.md" 1 "is not an exact MAJOR.MINOR.PATCH"
block 'This project uses Quest CLI 0.14.1. for tracker operations.' > "$S/trail.md"
check 'trailing dot fails by name' "$S/trail.md" 1 "is not an exact MAJOR.MINOR.PATCH"
block 'This project uses Quest CLI ^0.14.1 for tracker operations.' > "$S/range.md"
check 'range operator fails by name' "$S/range.md" 1 "is not an exact MAJOR.MINOR.PATCH"
block 'This project uses Quest CLI latest for tracker operations.' > "$S/tag.md"
check 'dist-tag fails by name' "$S/tag.md" 1 "is not an exact MAJOR.MINOR.PATCH"

# 4. missing markers / missing line / duplicate block
echo 'This project uses Quest CLI 0.14.1 for tracker operations.' > "$S/nomarkers.md"
check 'no markers fails by name' "$S/nomarkers.md" 1 "expected exactly one"
block 'No version line here.' > "$S/noline.md"
check 'no version line inside the block fails by name' "$S/noline.md" 1 "no 'Quest CLI <version>"
{ block 'This project uses Quest CLI 0.14.1 for tracker operations.'; block 'This project uses Quest CLI 0.13.0 for tracker operations.'; } > "$S/dup.md"
check 'two blocks fail by name' "$S/dup.md" 1 "expected exactly one"
printf '%s\n%s\n' "$END" "$BEGIN" > "$S/swapped.md"
check 'markers out of order fail by name' "$S/swapped.md" 1 "markers are out of order"
# The dangerous swap: end first, begin second, with a VALID version line after the
# begin marker. Counting markers passes this (one of each), and a read from the
# line after begin would return 0.14.1 from outside any block (Opus M1).
printf '%s\n%s\n%s\n' "$END" "$BEGIN" 'This project uses Quest CLI 0.14.1 for tracker operations.' > "$S/swapped-version.md"
check 'swapped markers WITH a version line after begin fail by name' "$S/swapped-version.md" 1 "markers are out of order"
out="$(bash "$READER" "$S/swapped-version.md" 2>/dev/null)"
[ -z "$out" ] && ok 'the swapped fixture printed no version on stdout' || no 'the swapped fixture printed a version' 0 "$out"

# Two declaring lines inside one block are ambiguous, not "take the first".
block "$(printf 'This project uses Quest CLI 0.14.1 for tracker operations.\nAlso Quest CLI 0.13.0 for tracker operations.')" > "$S/twolines.md"
check 'two version lines in the block fail by name' "$S/twolines.md" 1 "declare a Quest CLI version; exactly one is expected"

# CRLF is named as the cause, not reported as missing markers.
block 'This project uses Quest CLI 0.14.1 for tracker operations.' | sed 's/$/\r/' > "$S/crlf.md"
check 'CRLF line endings are named as the cause' "$S/crlf.md" 1 "carriage returns (CRLF line endings)"
check 'missing file fails by name' "$S/does-not-exist.md" 1 "does not exist"

# 5. the repository's real CLAUDE.md must read cleanly: a positive control that
#    the suite measured the live file and not only its own fixtures.
live="$(bash "$READER" "$HERE/../../CLAUDE.md" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$live" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then ok "live CLAUDE.md reads $live"; else no 'live CLAUDE.md reads cleanly' "$rc" "$live"; fi

echo
echo "passed $pass, failed $fail"
# A suite that ran fewer cases than it was written for must not pass.
[ "$pass" -ge 17 ] || { echo "ran fewer than the 17 expected passing cases"; exit 1; }
[ "$fail" -eq 0 ]
