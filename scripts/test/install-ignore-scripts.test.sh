#!/usr/bin/env bash
# OMARK-101 (DEC-240 item 1). Proof that `npm install --ignore-scripts` still
# succeeds when a dependency carries a failing postinstall, and that without the
# flag the same dependency really does run and fail.
#
# Both arms matter. The accepting arm alone proves nothing if the postinstall
# never runs in this environment. So the CONTROL arm must show the script ran
# (a marker file, not an exit code) and that the install failed because of it.
#
# npm is not one thing across the versions CI and a developer machine use: npm
# 12 blocks dependency install scripts by default and offers
# --dangerously-allow-all-scripts to run them; the npm that setup-node 24 bundles
# runs them by default. So the control arm is chosen by whether the flag EXISTS
# in `npm install --help` (presence, not a version comparison), and if the script
# cannot be made to run at all the suite FAILS rather than skipping the arm. The
# npm version in use is printed so a later reader compares against their own.
set -uo pipefail

S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "  ok   $1"; }
no() { fail=$((fail+1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/       | /'; }
echo "environment: npm $(npm --version), node $(node --version)"

mkdir -p "$S/bad" "$S/top"
cat > "$S/bad/package.json" <<EOF
{"name":"bad-dep","version":"1.0.0","scripts":{"postinstall":"touch '$S/MARKER' && exit 1"}}
EOF
(cd "$S/bad" && npm pack --silent >/dev/null 2>&1)
[ -f "$S/bad/bad-dep-1.0.0.tgz" ] && ok 'fixture: the failing-postinstall dependency packed' || no 'fixture: npm pack produced no tarball'
cat > "$S/top/package.json" <<EOF
{"name":"top","version":"1.0.0","dependencies":{"bad-dep":"file:../bad/bad-dep-1.0.0.tgz"}}
EOF
reset_top() { rm -rf "$S/top/node_modules" "$S/top/package-lock.json" "$S/MARKER"; }
NPMFLAGS=(--offline --no-audit --no-fund)

# Arm 1: the flag CI now passes. Must succeed, and the script must NOT have run.
reset_top
(cd "$S/top" && npm install "${NPMFLAGS[@]}" --ignore-scripts >"$S/arm1.log" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok 'with --ignore-scripts the install exits 0 despite a failing postinstall' || no "with --ignore-scripts: expected exit 0, got $rc" "$(cat "$S/arm1.log")"
[ ! -e "$S/MARKER" ] && ok 'with --ignore-scripts the dependency postinstall did not run (no marker)' || no 'with --ignore-scripts the postinstall ran'
[ -d "$S/top/node_modules/bad-dep" ] && ok 'with --ignore-scripts the dependency was still installed (liveness)' || no 'with --ignore-scripts the dependency is missing' "$(cat "$S/arm1.log")"

# Arm 2: the control. Without the flag the script must run and fail the install.
reset_top
(cd "$S/top" && npm install "${NPMFLAGS[@]}" >"$S/arm2.log" 2>&1); rc2=$?
mode='default npm install'
if [ ! -e "$S/MARKER" ] && npm install --help 2>&1 | grep -q -e '--dangerously-allow-all-scripts'; then
  reset_top
  (cd "$S/top" && npm install "${NPMFLAGS[@]}" --dangerously-allow-all-scripts >"$S/arm2.log" 2>&1); rc2=$?
  mode='npm install --dangerously-allow-all-scripts (this npm blocks dependency scripts by default)'
fi
[ -e "$S/MARKER" ] && ok "control: without --ignore-scripts the postinstall RAN ($mode)" || no "control: the postinstall never ran, so the accepting arm proved nothing ($mode)" "$(cat "$S/arm2.log")"
[ "$rc2" -ne 0 ] && ok "control: that install exited non-zero ($rc2), so the failing script really would break an unhardened install" || no 'control: the install exited 0 even though the script ran and failed' "$(cat "$S/arm2.log")"

echo
echo "passed $pass, failed $fail"
[ "$pass" -ge 6 ] || { echo "ran fewer than the 6 expected passing cases"; exit 1; }
[ "$fail" -eq 0 ]
