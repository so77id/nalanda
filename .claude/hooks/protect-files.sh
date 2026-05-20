#!/bin/bash
# PreToolUse hook: block edits to sensitive or generated files.
# Exit code 2 = block the tool call with reason in stderr.

INPUT=$(cat)
# Extract file_path without jq (not installed on host)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

# Protected file patterns
case "$BASENAME" in
  .env|.env.*|package-lock.json|yarn.lock|pnpm-lock.yaml)
    echo "Blocked: $BASENAME is a protected file. Ask the user before modifying it." >&2
    exit 2
    ;;
esac

exit 0
