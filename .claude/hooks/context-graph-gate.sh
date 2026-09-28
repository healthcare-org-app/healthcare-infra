#!/usr/bin/env bash
# PreToolUse gate for Edit|Write|MultiEdit: requires a fresh Postman Context
# Graph check (see .claude/skills/context-graph-check) before touching the
# API surface (frontend/api/, postman/collections/, postman/environments/).
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
MARKER="$PROJECT_DIR/.claude/.context-graph-checked"
MAX_AGE_SECONDS=1800 # 30 minutes

input="$(cat)"
file_path="$(echo "$input" | jq -r '.tool_input.file_path // empty')"

allow() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
}

# Nothing to gate (unknown/empty path) — let normal permission flow handle it.
[[ -z "$file_path" ]] && allow

# Only gate the API surface.
if ! echo "$file_path" | grep -qE '(^|/)frontend/api/|(^|/)postman/collections/|(^|/)postman/environments/'; then
  allow
fi

if [[ -f "$MARKER" ]]; then
  mtime="$(stat -f %m "$MARKER" 2>/dev/null || stat -c %Y "$MARKER" 2>/dev/null || echo 0)"
  age=$(( $(date +%s) - mtime ))
  if [[ "$age" -lt "$MAX_AGE_SECONDS" ]]; then
    allow
  fi
fi

reason="Blocked: '$file_path' is on the API surface. Run the context-graph-check skill first (submitContextGraphAsk + getContextGraphAsk against the Postman Context Graph), which writes $MARKER on success — then retry this edit. The check is required once per session and expires after 30 minutes."
jq -n --arg reason "$reason" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}'
