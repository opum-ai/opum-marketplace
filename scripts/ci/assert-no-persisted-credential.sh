#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 2). Fail, by name, if the checkout left a credential in
# this repository's local git config.
#
# `persist-credentials: false` is a request to actions/checkout. Nothing in the
# workflow measures that it took effect, and a later edit that drops the line
# restores the default silently: the token sits in .git/config, readable by any
# step that follows. This runs right after a checkout and reads the result.
#
# Prints KEY NAMES only, never a value: the value is the credential.
# exit 0: no http.*.extraheader in the local config.
# exit 1: one was found, or the local config could not be read (an unreadable
#         config is not evidence of a clean one).
set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "::error::not inside a git work tree, so the checkout's credential state cannot be measured."
  exit 1
fi

# Positive control: the local config must have yielded at least one key, or a
# clean answer below would come from reading nothing.
# --includes on both reads: `git config --local` does not follow include or
# includeIf unless asked, so a credential moved into an included file would read
# as clean (OMARK-102 finding 6).
if ! all_keys="$(git config --local --includes --name-only --list)"; then
  echo "::error::could not read the local git config, so a persisted credential cannot be ruled out."
  exit 1
fi
nkeys="$(printf '%s\n' "$all_keys" | grep -c . || true)"
if [ "$nkeys" -lt 1 ]; then
  echo "::error::the local git config held no keys at all, so this check read nothing. A clean answer from an empty read is not a pass."
  exit 1
fi

# --get-regexp exits 1 when nothing matches; that is the clean case, not a failure.
found="$(git config --local --includes --name-only --get-regexp 'http\..*extraheader' || true)"
if [ -n "$found" ]; then
  echo "::error::the checkout persisted a credential in .git/config (key(s): $(printf '%s' "$found" | tr '\n' ' ')). Set 'persist-credentials: false' on that actions/checkout step. The value is deliberately not printed."
  exit 1
fi
echo "no persisted credential: read $nkeys local git config key(s), none matching http.*.extraheader."
