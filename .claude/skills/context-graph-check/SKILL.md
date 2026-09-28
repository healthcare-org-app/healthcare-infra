---
name: context-graph-check
description: Query the Postman Context Graph via the Postman MCP server before making any update in this repo (code, config, endpoints, env files, collections). Use whenever about to add/change/remove an API, endpoint, service, or dependency, to check how it fits the existing estate before editing.
---

# Context graph check before updates

Before making a change in this repo — new/modified endpoint, service, integration, env
var, collection, or any other update to the healthcare-org API surface — ask the
Postman Context Graph what already exists so the change is consistent with the real
estate instead of guessed from local code alone.

## When to run this

Trigger before:
- Adding, renaming, or removing an API endpoint, route, or service file (e.g. under
  `frontend/api/`).
- Changing request/response shapes, auth, or dependencies between services.
- Editing Postman collections/environments that mirror the gateway.
- Any task the user frames as "update X" / "add X" / "change X" touching the API layer.

Skip it for pure copy edits, styling, docs, or changes with no API/service surface.

## How to run it

1. Submit a natural-language question scoped to the specific thing being changed —
   not a generic "what exists" query. Good examples:
   - "What services or collections currently call the appointments cancel endpoint?"
   - "Does a notion or docusign integration already exist for patient consent?"
   - "What depends on the nylas grants service?"

   ```
   mcp__plugin_postman_postman__submitContextGraphAsk({ query: "<specific question>" })
   ```
   This returns `{ askId, status: "pending" }` — it does not return the answer yet.

2. Poll for the result, leaving a few seconds between polls:
   ```
   mcp__plugin_postman_postman__getContextGraphAsk({ askId })
   ```
   Keep polling while `status` is `pending` or `running`. Stop once `status` is
   `completed` (use `result.answer` plus `result.citations`/`result.provenance`) or
   `failed` (short `error` field — fall back to local code search and say the ask
   failed).

3. If `result.provenance.truncated` is `true`, note that the answer is partial before
   relying on it.

4. Use the answer to inform the update — e.g. avoid duplicating an existing service,
   match existing naming/patterns, or flag a conflict to the user.

5. **Write the marker file** so the enforcement hook (below) lets the edit through:
   ```
   touch .claude/.context-graph-checked
   ```
   Do this once the ask reaches `completed` or `failed` — not before submitting it.
   Then proceed with the actual edit.

## Enforcement

A `PreToolUse` hook (`.claude/hooks/context-graph-gate.sh`, wired in
`.claude/settings.json`) blocks `Edit`/`Write`/`MultiEdit` on `frontend/api/`,
`postman/collections/`, and `postman/environments/` paths unless
`.claude/.context-graph-checked` exists and is less than 30 minutes old. A
`SessionStart` hook removes the marker at the start of every session, so this check
runs at least once per session, and again after 30 minutes of a session's continued
use. If the hook denies an edit, run this skill's steps, then retry the edit — don't
just `touch` the marker without actually asking.

## Notes

- Each ask counts against the team's Context Graph quota — ask one well-formed
  question per change, not several variations.
- This tool answers estate-wide questions (what exists, how things depend on each
  other). For looking up a specific collection/request by name, use
  `searchPostmanElements` instead, not this flow.
- Requires Context Graph to be enabled for the team; if `submitContextGraphAsk` errors
  out entirely (not just an empty/low-signal answer), tell the user, then still write
  the marker so the enforcement hook doesn't leave you permanently stuck — the hook
  can only detect that a check ran, not that the estate lookup fully succeeded.
