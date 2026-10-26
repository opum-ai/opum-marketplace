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
# Every failure names which of the three things went wrong, as ::error:: lines.
set -euo pipefail

file="${1:-CLAUDE.md}"
begin='<!-- quest:agent-instructions:begin -->'
end='<!-- quest:agent-instructions:end -->'

if [ ! -f "$file" ]; then
  echo "::error::$file does not exist, so no Quest version can be read." >&2
  exit 1
fi

# Exactly one begin and one end marker, begin first. Two blocks would leave
# "the managed block" ambiguous, and a version read from the wrong one would
# reach npm.
nbegin="$(grep -cxF "$begin" "$file" || true)"
nend="$(grep -cxF "$end" "$file" || true)"
if [ "$nbegin" -ne 1 ] || [ "$nend" -ne 1 ]; then
  echo "::error file=$file::expected exactly one '$begin' and one '$end' marker, found $nbegin and $nend. The Quest version is read only from inside the managed block, so it cannot be read." >&2
  exit 1
fi

block="$(awk -v b="$begin" -v e="$end" '$0 == b {on=1; next} $0 == e {on=0} on {print}' "$file")"
if [ -z "$block" ]; then
  echo "::error file=$file::the managed Quest block between its markers is empty or its markers are out of order." >&2
  exit 1
fi

version="$(printf '%s\n' "$block" | sed -n 's/.*Quest CLI \([^ ]*\) for tracker operations.*/\1/p' | head -1)"
if [ -z "$version" ]; then
  echo "::error file=$file::no 'Quest CLI <version> for tracker operations' line inside the managed Quest block." >&2
  exit 1
fi
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error file=$file::the Quest version '$version' is not an exact MAJOR.MINOR.PATCH. npm would treat a partial version as a range, so it is refused before it can reach npm." >&2
  exit 1
fi
printf '%s\n' "$version"
