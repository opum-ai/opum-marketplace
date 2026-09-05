#!/usr/bin/env bash
# Seeds a realistic Opum repository so this case tests task-before-branch
# reasoning rather than environment forensics.
#
# The empty sandbox `claude plugin eval` provides by default is why this case
# was flaky at 1/3 (OPAG-45): the prompt asks the agent to get set up, and with
# no repo, no tracker and no CI config there was nothing to get set up against,
# so every run spent its whole turn budget establishing that and whether it also
# produced a branch name was incidental.
#
# Deliberately seeded WITHOUT a task for the double-run bug. The tracker is
# visibly real and visibly does not contain this bug, so the correct response
# has to create the task before naming a branch — which is the behaviour under
# test. Seeding a ready-made task id would hand the agent the answer.
set -euo pipefail

git init -q .
git config user.email "eval@opum.invalid"
git config user.name "Opum Eval"

mkdir -p .quest/tasks src .github/workflows

cat > .quest/workspace.toml <<'EOF'
name = "opum-probe"
prefix = "OPRB"
EOF

# Two unrelated tasks: the tracker is real, and this bug is not in it.
cat > .quest/tasks/OPRB-1.json <<'EOF'
{"id":"OPRB-1","title":"Add --json output to the probe CLI","status":"Done","type":"feature","priority":"Medium"}
EOF
cat > .quest/tasks/OPRB-2.json <<'EOF'
{"id":"OPRB-2","title":"Document the probe CLI exit codes","status":"To Do","type":"chore","priority":"Low"}
EOF

cat > package.json <<'EOF'
{
  "name": "opum-probe-cli",
  "version": "0.1.0",
  "bin": { "probe": "./src/cli.js" },
  "scripts": { "check": "node --test" }
}
EOF

cat > src/cli.js <<'EOF'
#!/usr/bin/env node
function main() {
  console.log('probe: running');
}
main();
module.exports = { main };
EOF

# The actual bug the prompt refers to: the workflow fires on both push and
# pull_request, so every PR commit runs the CLI twice on the same SHA.
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on:
  push:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run check
EOF

git add -A
git commit -qm "Seed probe CLI, tracker and CI workflow"
