---
type: llm
weight: 1
---

A successful response describes the two-step promotion: open a PR from `dev` to
`main` so required checks run against that exact SHA, then land it with
`git push origin dev:main`.

It must explicitly warn against using **GitHub's merge button**, and give the
reason — a merge commit lands on `main` that never reaches `dev`, so `main` stops
being an ancestor and can never fast-forward again.

Credit a response that says which ref carries the required-checks rule differs
per repository and should be checked rather than assumed.

Fail the response if it recommends the merge button, a regular merge commit, or a
force-push, or if it presents a fast-forward promotion as something that always
needs the user's direct authorisation without reference to the conditions.
