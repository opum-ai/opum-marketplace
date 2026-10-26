#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 2 and (a2)). Proof of HOW scripts/ci/assert-main-fast-forward.sh
# hands a token to its one post-checkout fetch.
#
# What this proves and what it cannot. A PR never exercises the promotion path
# (this guard runs only on a push to main), so the wiring is proved here with a
# git shim that records, per invocation, the arguments and the GIT_CONFIG_*
# environment git actually received, then execs the real git. It proves the
# SHAPE the ruling requires: the token arrives through git's environment config on
# the fetch, only there, never as an argument, never in .git/config. It does NOT
# prove GitHub accepts that header; that is measured on the first real
# dev-to-main promotion after landing, as the ruling says.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../ci/assert-main-fast-forward.sh"
REAL_GIT="$(command -v git)"
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok   $1"; }
no() { fail=$((fail+1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       | /'; }
TOKEN='ghs_FAKETOKEN0123456789'
EXPECT_B64="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"

mkdir -p "$S/shim"
cat > "$S/shim/git" <<EOF
#!/usr/bin/env bash
printf '%s\t%s\t%s\t%s\n' "\$*" "\${GIT_CONFIG_COUNT-unset}" "\${GIT_CONFIG_KEY_0-unset}" "\${GIT_CONFIG_VALUE_0-unset}" >> "\$GIT_SHIM_LOG"
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$S/shim/git"

# A bare origin with dev = c1..c2 and main = c1, and a clone standing in for the
# checkout. Local-path remote: nothing here touches the network.
git init -q --bare -b dev "$S/origin"
git clone -q "$S/origin" "$S/work" 2>/dev/null
git -C "$S/work" config user.email t@t; git -C "$S/work" config user.name t
echo 1 > "$S/work/a"; git -C "$S/work" add .; git -C "$S/work" commit -qm c1
git -C "$S/work" push -q origin dev
C1="$(git -C "$S/work" rev-parse HEAD)"
git -C "$S/work" push -q origin "${C1}:refs/heads/main"
echo 2 > "$S/work/b"; git -C "$S/work" add .; git -C "$S/work" commit -qm c2
git -C "$S/work" push -q origin dev
C2="$(git -C "$S/work" rev-parse HEAD)"
git -C "$S/work" push -q origin "${C2}:refs/heads/main"

# run_guard <label> <token-or-empty>  -> sets OUT, RC, LOG
run_guard() {
  LOG="$S/shim-$1.log"; : > "$LOG"
  if [ -n "$2" ]; then
    OUT="$(cd "$S/work" && PATH="$S/shim:$PATH" GIT_SHIM_LOG="$LOG" BEFORE_SHA="$C1" FORCED=false DEV_FETCH_TOKEN="$2" bash "$GUARD" 2>&1)"; RC=$?
  else
    OUT="$(cd "$S/work" && PATH="$S/shim:$PATH" GIT_SHIM_LOG="$LOG" BEFORE_SHA="$C1" FORCED=false bash "$GUARD" 2>&1)"; RC=$?
  fi
}

# --- token set -------------------------------------------------------------
run_guard with "$TOKEN"
[ "$RC" -eq 0 ] && ok 'with token: the guard ran to a green exit 0' || no "with token: expected exit 0, got $RC" "$OUT"
FETCH_RE='(^|[[:space:]])fetch[[:space:]]'
fetch_lines="$(grep -E "$FETCH_RE" "$LOG")"
[ "$(printf '%s\n' "$fetch_lines" | grep -c .)" -eq 1 ] && ok 'with token: exactly one git fetch ran (liveness)' || no 'with token: expected exactly one fetch' "$fetch_lines"
printf '%s\n' "$fetch_lines" | awk -F'\t' 'NR==1{good=($2=="1" && $3=="http.https://github.com/.extraheader" && $4=="AUTHORIZATION: basic '"$EXPECT_B64"'")} END{exit !(NR==1 && good)}' \
  && ok 'with token: the fetch got COUNT=1, the extraheader key and the basic-auth value in its environment' || no 'with token: fetch environment is wrong' "$fetch_lines"
if grep -qF -e "$TOKEN" -e "$EXPECT_B64" <<<"$(cut -f1 "$LOG")"; then no 'with token: the token (raw or base64) appears in an ARGUMENT' "$(cut -f1 "$LOG")"; else ok 'with token: neither the raw token nor its base64 is in any git argument'; fi
grep -qE '(^| )-c( |$)' <<<"$(cut -f1 "$LOG")" && no 'with token: a -c argument was used' "$(cut -f1 "$LOG")" || ok 'with token: no -c argument was used'
others="$(grep -v -E "$FETCH_RE" "$LOG" | cut -f2 | sort -u)"
[ "$others" = "unset" ] && ok 'with token: every NON-fetch git call ran with no GIT_CONFIG_COUNT (the token reached the fetch only)' || no 'with token: a non-fetch git call carried GIT_CONFIG_COUNT' "$others"
if grep -rqiE 'extraheader|AUTHORIZATION|'"$TOKEN" "$S/work/.git/config"; then no 'with token: a credential was written to .git/config' "$(cat "$S/work/.git/config")"; else ok 'with token: nothing credential-shaped in .git/config'; fi
printf '%s' "$OUT" | grep -qF -- "$TOKEN" && no 'with token: the raw token appeared in the guard output' "$OUT" || ok 'with token: the raw token is not in the guard output'

# --- token unset -----------------------------------------------------------
run_guard without ""
[ "$RC" -eq 0 ] && ok 'without token: the guard ran to a green exit 0 (anonymous fetch path)' || no "without token: expected exit 0, got $RC" "$OUT"
fl="$(grep -E "$FETCH_RE" "$LOG")"
[ "$(printf '%s\n' "$fl" | grep -c .)" -eq 1 ] && printf '%s\n' "$fl" | awk -F'\t' 'NR==1{good=($2=="unset")} END{exit !(NR==1 && good)}' \
  && ok 'without token: one fetch, and it carried no GIT_CONFIG_COUNT' || no 'without token: fetch carried git config env or did not run' "$fl"

# --- fail closed, token set -----------------------------------------------
git -C "$S/origin" branch -m dev gone-dev 2>/dev/null
run_guard closed "$TOKEN"
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qF 'could not fetch dev from origin'; then ok 'a failing fetch fails closed with its own message, exit 1'; else no "failing fetch: want exit 1 + 'could not fetch dev', got exit $RC" "$OUT"; fi
printf '%s' "$OUT" | grep -qF -- "$TOKEN" && no 'fail-closed output leaked the raw token' "$OUT" || ok 'the fail-closed output does not contain the raw token'

echo
echo "passed $pass, failed $fail"
[ "$pass" -ge 12 ] || { echo "ran fewer than the 12 expected passing cases"; exit 1; }
[ "$fail" -eq 0 ]
