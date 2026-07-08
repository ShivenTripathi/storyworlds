#!/bin/bash
# PostToolUse hook (Write|Edit): auto-fix lint on edited TS/TSX files.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
case "$file" in
  */src/*.ts|*/src/*.tsx)
    cd "$(dirname "$0")/../.." && npx eslint --fix "$file" 2>/dev/null || true
    ;;
esac
exit 0
