#!/bin/bash
# PostToolUse hook (Write|Edit): block commits of obvious secrets.
# This repo once leaked an LLM API key into git history — never again.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] || [ ! -f "$file" ] && exit 0
case "$file" in
  *.env.example|*/.claude/hooks/*) exit 0 ;;
esac
pattern='sk-ant-[A-Za-z0-9_-]{20,}|sk-emergent-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|whsec_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{20,}'
if grep -qE "$pattern" "$file" 2>/dev/null; then
  echo "BLOCKED: $file appears to contain a real secret (API key / private key pattern). Secrets belong in .env (gitignored), never in source. Remove it and reference process.env instead." >&2
  exit 2
fi
exit 0
