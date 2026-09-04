#!/bin/sh
# SessionEnd: flush state before the session that holds it goes away.
exec "$(dirname "$0")/flush-state.sh" session-end
