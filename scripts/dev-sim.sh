#!/usr/bin/env bash
# Start/stop the insurance-dev simulation and inspect which upstream calls the service made.
#   scripts/dev-sim.sh start [path/to/x.sim.yaml]   (default: postman/simulations/insurance-dev.sim.yaml)
#   scripts/dev-sim.sh stop
#   scripts/dev-sim.sh calls                        (upstream calls as: routeKey METHOD path -> status)
#   scripts/dev-sim.sh clear                        (truncate the call log between test runs)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SIM_PORT:-4300}"
STATE="${TMPDIR:-/tmp}/insurance-sim"
LOG="$STATE/sim.ndjson"
PIDFILE="$STATE/sim.pid"
mkdir -p "$STATE"

case "${1:-start}" in
  start)
    SIM="${2:-$ROOT/postman/simulations/insurance-dev.sim.yaml}"
    [[ -f "$SIM" ]] || { echo "no simulation file at $SIM" >&2; exit 1; }
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE")) on :$PORT"; exit 0
    fi
    : > "$LOG"
    # exec so the stored pid is the serving process, not a wrapper shell
    nohup bash -c "exec postman simulation run '$SIM' --port $PORT --output ndjson --no-history" \
      >> "$LOG" 2> "$STATE/sim.err" &   # append mode, so 'clear' truncation doesn't leave NUL padding
    echo $! > "$PIDFILE"
    for _ in $(seq 1 30); do
      grep -q '"event":"listening"' "$LOG" 2>/dev/null && break
      sleep 0.5
    done
    grep -q '"event":"listening"' "$LOG" || { echo "simulation failed to start:" >&2; cat "$STATE/sim.err" >&2; exit 1; }
    echo "simulation up on http://localhost:$PORT (log: $LOG)"
    jq -r 'select(.event=="listening") | .mocks[] | "  \(.address)"' "$LOG"
    ;;
  stop)
    # The postman launcher spawns a separate serving binary; killing only the
    # launcher leaves the port bound, so also kill whatever is listening on it.
    [[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
    listeners="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -n "$listeners" ]]; then kill $listeners; echo "stopped"; else echo "not running"; fi
    rm -f "$PIDFILE"
    ;;
  calls)
    jq -r 'select(.event=="request") | "\(.routeKey)\t\(.method)\t\(.path)\t-> \(.statusCode)\t\(.requestBody // "" | tostring)"' "$LOG"
    ;;
  clear)
    : > "$LOG"
    ;;
  *)
    echo "usage: scripts/dev-sim.sh start|stop|calls|clear" >&2; exit 2
    ;;
esac
