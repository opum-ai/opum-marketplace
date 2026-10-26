#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 2). Proof for scripts/ci/assert-no-persisted-credential.sh,
# both ways: a clean checkout-shaped repo passes, and a repo carrying the exact key
# actions/checkout writes when it persists credentials fails BY NAME without
# printing the secret.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/../ci/assert-no-persisted-credential.sh"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok   $1"; }
no() { fail=$((fail+1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       | /'; }
SECRET='AUTHORIZATION: basic c2VjcmV0LXZhbHVl'

run_in() { OUT="$(cd "$1" && bash "$CHECK" 2>&1)"; RC=$?; }

mkdir "$S/clean" && git init -q "$S/clean"
run_in "$S/clean"
{ [ "$RC" -eq 0 ] && grep -qF 'no persisted credential: read' <<<"$OUT"; } && ok 'a clean repo passes and reports how many keys it read' || no "clean repo: exit $RC" "$OUT"

mkdir "$S/dirty" && git init -q "$S/dirty"
git -C "$S/dirty" config --local http.https://github.com/.extraheader "$SECRET"
run_in "$S/dirty"
{ [ "$RC" -eq 1 ] && grep -qF 'persisted a credential' <<<"$OUT" && grep -qF 'http.https://github.com/.extraheader' <<<"$OUT"; } && ok 'a persisted extraheader fails by name with exit 1 and names the key' || no "dirty repo: exit $RC" "$OUT"
grep -qF -- "$SECRET" <<<"$OUT" && no 'the credential VALUE was printed' "$OUT" || ok 'the credential value is not printed'
grep -qF 'c2VjcmV0LXZhbHVl' <<<"$OUT" && no 'the base64 credential was printed' "$OUT" || ok 'the base64 form is not printed either'

mkdir "$S/notgit"
run_in "$S/notgit"
{ [ "$RC" -eq 1 ] && grep -qF 'not inside a git work tree' <<<"$OUT"; } && ok 'outside a git work tree it fails by name, not as a pass' || no "non-repo: exit $RC" "$OUT"

# A different host's extraheader key is the same shape and must also fail.
mkdir "$S/ghe" && git init -q "$S/ghe"
git -C "$S/ghe" config --local http.https://ghe.example.com/.extraheader "$SECRET"
run_in "$S/ghe"
[ "$RC" -eq 1 ] && ok 'an extraheader for another host also fails' || no "other-host extraheader: exit $RC" "$OUT"

# Unrelated http config must not trip it.
mkdir "$S/benign" && git init -q "$S/benign"
git -C "$S/benign" config --local http.postBuffer 524288000
run_in "$S/benign"
[ "$RC" -eq 0 ] && ok 'unrelated http.* config does not trip the check' || no "benign http config: exit $RC" "$OUT"

echo
echo "passed $pass, failed $fail"
[ "$pass" -ge 7 ] || { echo "ran fewer than the 7 expected passing cases"; exit 1; }
[ "$fail" -eq 0 ]
