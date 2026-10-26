#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 1). Proof that a GLOBAL `npm install -g --ignore-scripts`
# still succeeds when a TRANSITIVE dependency carries a failing postinstall, and
# that without the flag the same dependency really does run and fail.
#
# It mirrors the shape CI uses: `-g` (into a throwaway --prefix, so nothing on the
# machine changes), a top-level package that DEPENDS on the failing one, and the
# job's own npm (the manifest job runs setup-node 24; this proof is meant to be
# read against that npm, and prints which one it ran under).
#
# Both arms matter. The accepting arm alone proves nothing if the postinstall
# never runs in this environment. So the CONTROL arm must show the script ran
# (a marker file, not an exit code) and that the install failed because of it.
#
# npm is not one thing across versions: npm 12 blocks dependency install scripts by
# default and offers --dangerously-allow-all-scripts to run them; the npm that
# setup-node 24 bundles runs them by default. So the control arm is chosen by
# whether that flag EXISTS in `npm install --help` (presence, not a version
# comparison), and if the script cannot be made to run at all the suite FAILS
# rather than skipping the arm.
set -uo pipefail

S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok   $1"; }
no() { fail=$((fail+1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       | /'; }
# Each substitution is its own assignment: a $(...) inside an argument list would
# not stop the script if npm were missing.
npm_version="$(npm --version)"
node_version="$(node --version)"
echo "environment: npm $npm_version, node $node_version"

mkdir -p "$S/bad" "$S/top"
cat > "$S/bad/package.json" <<EOF
{"name":"bad-dep","version":"1.0.0","scripts":{"postinstall":"touch '$S/MARKER' && exit 1"}}
EOF
(cd "$S/bad" && npm pack --silent >/dev/null 2>&1)
cat > "$S/top/package.json" <<EOF
{"name":"top","version":"1.0.0","dependencies":{"bad-dep":"file:$S/bad/bad-dep-1.0.0.tgz"}}
EOF
(cd "$S/top" && npm pack --silent >/dev/null 2>&1)
{ [ -f "$S/bad/bad-dep-1.0.0.tgz" ] && [ -f "$S/top/top-1.0.0.tgz" ]; } && ok 'fixture: both packages packed (top depends on the failing one)' || no 'fixture: npm pack produced no tarball'

reset_prefix() { rm -rf "$S/prefix" "$S/MARKER"; mkdir -p "$S/prefix"; }
NPMFLAGS=(--offline --no-audit --no-fund -g --prefix "$S/prefix")
installed() { [ -d "$S/prefix/lib/node_modules/top" ] && [ -d "$S/prefix/lib/node_modules/top/node_modules/bad-dep" -o -d "$S/prefix/lib/node_modules/bad-dep" ]; }

# Arm 1: the flag CI now passes. Must succeed, and the script must NOT have run.
reset_prefix
npm install "${NPMFLAGS[@]}" --ignore-scripts "$S/top/top-1.0.0.tgz" >"$S/arm1.log" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok 'with -g --ignore-scripts the install exits 0 despite a failing transitive postinstall' || no "with -g --ignore-scripts: expected exit 0, got $rc" "$(cat "$S/arm1.log")"
[ ! -e "$S/MARKER" ] && ok 'with --ignore-scripts the dependency postinstall did not run (no marker)' || no 'with --ignore-scripts the postinstall ran'
installed && ok 'with --ignore-scripts both packages were still installed (liveness)' || no 'with --ignore-scripts the packages are missing' "$(cat "$S/arm1.log")"

# Arm 2: the control. Without the flag the script must run and fail the install.
reset_prefix
npm install "${NPMFLAGS[@]}" "$S/top/top-1.0.0.tgz" >"$S/arm2.log" 2>&1; rc2=$?
mode='default global install'
if [ ! -e "$S/MARKER" ] && npm install --help 2>&1 | grep -q -e '--dangerously-allow-all-scripts'; then
  reset_prefix
  npm install "${NPMFLAGS[@]}" --dangerously-allow-all-scripts "$S/top/top-1.0.0.tgz" >"$S/arm2.log" 2>&1; rc2=$?
  mode='--dangerously-allow-all-scripts (this npm blocks dependency scripts by default)'
fi
[ -e "$S/MARKER" ] && ok "control: without --ignore-scripts the postinstall RAN ($mode)" || no "control: the postinstall never ran, so the accepting arm proved nothing ($mode)" "$(cat "$S/arm2.log")"
[ "$rc2" -ne 0 ] && ok "control: that install exited non-zero ($rc2), so the failing script really would break an unhardened install" || no 'control: the install exited 0 even though the script ran and failed' "$(cat "$S/arm2.log")"

echo
echo "passed $pass, failed $fail"
[ "$pass" -ge 6 ] || { echo "ran fewer than the 6 expected passing cases"; exit 1; }
[ "$fail" -eq 0 ]
