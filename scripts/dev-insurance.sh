#!/usr/bin/env bash
# Run the real insurance service locally, pointed at the simulation (scripts/dev-sim.sh).
#   scripts/dev-insurance.sh start | stop | restart | logs
# Override a dependency for one run, e.g. force billing to fail:
#   BILLING_API_URL=http://localhost:4300/billing-down scripts/dev-insurance.sh restart
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SERVE_PORT:-4400}"
SIM="http://localhost:${SIM_PORT:-4300}"
STATE="${TMPDIR:-/tmp}/insurance-sim"
LOG="$STATE/serve.log"
mkdir -p "$STATE"

stop() {
  local pids; pids="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then kill $pids; echo "stopped"; else echo "not running"; fi
}

start() {
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "already running on :$PORT"; return; fi
  : > "$LOG"
  GATEWAY_API_KEY="${GATEWAY_API_KEY:-demo-key}" \
  PATIENTS_API_URL="${PATIENTS_API_URL:-$SIM/patients}" \
  CLAIMS_API_URL="${CLAIMS_API_URL:-$SIM/claims}" \
  BILLING_API_URL="${BILLING_API_URL:-$SIM/billing}" \
  NOTIFICATIONS_API_URL="${NOTIFICATIONS_API_URL:-$SIM/notifications}" \
  PORT="$PORT" nohup node "$ROOT/scripts/dev-insurance.mjs" >> "$LOG" 2>&1 &
  for _ in $(seq 1 20); do grep -q "insurance service on" "$LOG" 2>/dev/null && break; sleep 0.25; done
  grep -q "insurance service on" "$LOG" || { echo "failed to start:" >&2; cat "$LOG" >&2; exit 1; }
  echo "insurance service up on http://localhost:$PORT (bearer demo-key; upstreams -> $SIM)"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop >/dev/null; sleep 0.5; start ;;
  logs) cat "$LOG" ;;
  *) echo "usage: scripts/dev-insurance.sh start|stop|restart|logs" >&2; exit 2 ;;
esac
