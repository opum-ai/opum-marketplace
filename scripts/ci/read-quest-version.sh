#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 3). Print the Quest CLI version CLAUDE.md declares.
#
# The version is read ONLY from inside the managed Quest block's markers, and
# must be exactly MAJOR.MINOR.PATCH. The two CI jobs that install quest used to
# take the first "Quest CLI <digits and dots>" match anywhere in the file, which
# (a) could be prose outside the managed block and (b) admitted a partial
# version such as "0.14", which npm treats as a range, not a version.
#
# usage: read-quest-version.sh [path-to-CLAUDE.md]   (default: CLAUDE.md)
# stdout: the version, nothing else. exit 0 only when a valid version was read.
# Every failure names which thing went wrong, as ::error:: lines on stderr.
set -euo pipefail

file="${1:-CLAUDE.md}"
begin='<!-- quest:agent-instructions:begin -->'
end='<!-- quest:agent-instructions:end -->'

if [ ! -f "$file" ]; then
  echo "::error::$file does not exist, so no Quest version can be read." >&2
  exit 1
fi

# CRLF line endings make every exact-line marker comparison below fail, and the
# failure would read as "markers missing". Name the real cause first.
if grep -q $'\r' "$file"; then
  echo "::error file=$file::$file contains carriage returns (CRLF line endings). The managed-block markers are matched as exact lines, so they cannot be found; convert the file to LF line endings." >&2
  exit 1
fi

# Exactly one begin and one end marker. Two blocks would leave "the managed
# block" ambiguous, and a version read from the wrong one would reach npm.
nbegin="$(grep -cxF "$begin" "$file" || true)"
nend="$(grep -cxF "$end" "$file" || true)"
if [ "$nbegin" -ne 1 ] || [ "$nend" -ne 1 ]; then
  echo "::error file=$file::expected exactly one '$begin' and one '$end' marker, found $nbegin and $nend. The Quest version is read only from inside the managed block, so it cannot be read." >&2
  exit 1
fi

# Order by LINE NUMBER. Counting markers cannot tell begin-then-end from
# end-then-begin, and the swapped form with a version line after the begin marker
# would otherwise read a version from outside any block.
begin_line="$(grep -nxF "$begin" "$file" | cut -d: -f1)"
end_line="$(grep -nxF "$end" "$file" | cut -d: -f1)"
if [ "$begin_line" -ge "$end_line" ]; then
  echo "::error file=$file::the managed Quest block's markers are out of order: begin is on line $begin_line and end is on line $end_line. The version is read only from between them (begin first), so it cannot be read." >&2
  exit 1
fi

block="$(sed -n "$((begin_line + 1)),$((end_line - 1))p" "$file")"
if [ -z "$block" ]; then
  echo "::error file=$file::the managed Quest block between its markers (lines $begin_line to $end_line) is empty." >&2
  exit 1
fi

# Exactly one declaring line. Two would mean the block says two things, and
# taking the first silently is how a wrong version reaches npm.
lines="$(printf '%s\n' "$block" | grep -E 'Quest CLI [^ ]+ for tracker operations' || true)"
nlines="$(printf '%s' "$lines" | grep -c . || true)"
if [ "$nlines" -eq 0 ]; then
  echo "::error file=$file::no 'Quest CLI <version> for tracker operations' line inside the managed Quest block." >&2
  exit 1
fi
if [ "$nlines" -gt 1 ]; then
  echo "::error file=$file::$nlines lines inside the managed Quest block declare a Quest CLI version; exactly one is expected, so the version is ambiguous." >&2
  exit 1
fi

version="$(printf '%s\n' "$lines" | sed -n 's/.*Quest CLI \([^ ]*\) for tracker operations.*/\1/p')"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error file=$file::the Quest version '$version' is not an exact MAJOR.MINOR.PATCH. npm would treat a partial version as a range, so it is refused before it can reach npm." >&2
  exit 1
fi
printf '%s\n' "$version"
