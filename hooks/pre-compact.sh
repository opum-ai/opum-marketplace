#!/bin/sh
# PreCompact: flush state before the context that holds it is compressed away.
exec "$(dirname "$0")/flush-state.sh" pre-compact
