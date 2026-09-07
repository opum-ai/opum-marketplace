Check the live tracker for ready work:

    quest task list --ready

If nothing is ready, say so and stop rather than inventing work.

Otherwise, claim the next ready task —

    quest task edit <id> --status "In Progress" \
      --actor <id> --actor-kind delegated-agent --accountable-human <id>

— and work it. Ground yourself in a Lore-compiled context pack for the task's
profile before reading the repository directly:

    lore agent context <profile> --task "<task>"

Write status back to Quest as you go — notes, modified files, references —
and check acceptance criteria only with evidence in hand. Never edit `.quest/`
JSON directly. End the iteration with the task's status current on the
tracker, whether or not the work itself finished.
