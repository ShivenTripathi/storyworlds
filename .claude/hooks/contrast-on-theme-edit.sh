#!/bin/bash
# PostToolUse hook (Write|Edit): when a theme file changes, run the WCAG
# contrast gate so archetype color edits can never silently ship failing
# contrast. Exits 2 with the failure output so the model self-corrects.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
case "$file" in
  */src/theme/*|*/src/app/globals.css)
    out=$(cd "$(dirname "$0")/../.." && npm run -s check:contrast 2>&1)
    if [ $? -ne 0 ]; then
      echo "WCAG contrast check FAILED after editing a theme file:" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
