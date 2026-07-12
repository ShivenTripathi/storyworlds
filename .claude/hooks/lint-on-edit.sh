#!/bin/bash
# PostToolUse hook (Write|Edit): auto-fix lint + order Tailwind classes on
# edited source files. eslint --fix handles lint/a11y autofixes; prettier
# (with prettier-plugin-tailwindcss) canonicalizes Tailwind class order.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
root="$(dirname "$0")/../.."
case "$file" in
  */src/*.ts|*/src/*.tsx)
    ( cd "$root" && npx eslint --fix "$file" 2>/dev/null; npx prettier --write "$file" 2>/dev/null ) || true
    ;;
  */src/*.css)
    ( cd "$root" && npx prettier --write "$file" 2>/dev/null ) || true
    ;;
esac
exit 0
