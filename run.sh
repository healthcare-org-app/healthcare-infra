#!/usr/bin/env bash
# healthcare-org — run named stacks of services on top of the shared infra.
#
# Usage:
#   ./run.sh <stack> [<stack> ...] [up|down|logs|ps|restart|pull|build]
#
# Examples:
#   ./run.sh infra                       # postgres + kafka + redis + consul only
#   ./run.sh core                        # infra + baseline platform services
#   ./run.sh clinical                    # core + EHR/labs/pharmacy/appointments
#   ./run.sh billing insurance           # unions the two stacks (plus core, plus infra)
#   ./run.sh all                         # attempts to start every service (heavy)
#   ./run.sh core down                   # stop
#   ./run.sh core logs                   # tail logs
#   ./run.sh --list                      # show available stacks
#
# Stacks are additive. `infra` is always included implicitly.
# `core` is included implicitly by any non-infra, non-all stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"
PROJECT_NAME="healthcare-org"

# Services live in sibling repos at the workspace root, one directory per
# service, named healthcare-<service> — e.g. auth-service lives in
# healthcare-auth. Stack definitions use registry names; the `all` stack
# discovers directory names directly, so both forms are accepted.
service_dir() {
  case "$1" in
    healthcare-*) echo "$1" ;;
    *)            echo "healthcare-${1%-service}" ;;
  esac
}

# ── Stack definitions ─────────────────────────────────────────────────
# Each stack function echoes a newline-separated list of service directory
# names (must match services/<name>/docker-compose.override.yml).

stack_services() {
  case "$1" in
    infra)      echo "" ;;
    core)       cat <<'EOF'
identity-service
auth-service
authorization-service
audit-log-service
patients-service
providers-service
notifications-service
EOF
      ;;
    clinical)   cat <<'EOF'
ehr-service
encounters-service
cpoe-service
appointments-service
lab-orders-service
lab-results-service
imaging-orders-service
imaging-results-service
prescriptions-service
pharmacy-service
EOF
      ;;
    billing)    cat <<'EOF'
billing-service
charge-capture-service
claims-submission-service
claims-adjudication-service
denials-service
invoicing-service
payments-service
statements-service
collections-service
EOF
      ;;
    insurance)  cat <<'EOF'
eligibility-service
prior-auth-service
coverage-verification-service
payer-directory
payer-edi-connect
claims-status-service
EOF
      ;;
    devices)    cat <<'EOF'
device-registry-service
device-telemetry-service
device-alerts-service
device-fleet-service
remote-monitoring-service
vitals-service
EOF
      ;;
    comms)      cat <<'EOF'
sms-gateway-service
email-gateway-service
push-gateway-service
patient-communications-service
secure-messaging-service
EOF
      ;;
    erp-bridge) echo "erp-bridge-service" ;;
    all)
      find "$REPO_ROOT" -maxdepth 2 -name docker-compose.override.yml \
        | xargs -n1 dirname | xargs -n1 basename
      ;;
    *)
      echo "Unknown stack: $1" >&2
      exit 2
      ;;
  esac
}

KNOWN_STACKS="infra core clinical billing insurance devices comms erp-bridge all"

usage() {
  sed -n '/^# healthcare-org/,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

list_stacks() {
  echo "Available stacks:"
  for name in $KNOWN_STACKS; do
    count=$(stack_services "$name" | awk 'NF' | wc -l | tr -d ' ')
    if [ "$name" = "infra" ]; then
      printf "  %-13s  (shared containers only — postgres, kafka, redis, consul)\n" "$name"
    elif [ "$name" = "all" ]; then
      printf "  %-13s  (all %s services)\n" "$name" "$count"
    else
      printf "  %-13s  (%s services; core is included implicitly)\n" "$name" "$count"
    fi
  done
  exit 0
}

# ── Argument parsing ─────────────────────────────────────────────────

COMMAND="up"
STACK_NAMES=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)  usage ;;
    --list)     list_stacks ;;
    up|down|logs|ps|restart|pull|build)
                COMMAND="$1"; shift ;;
    -*)         echo "Unknown flag: $1" >&2; exit 2 ;;
    *)          STACK_NAMES="$STACK_NAMES $1"; shift ;;
  esac
done

STACK_NAMES=$(echo "$STACK_NAMES" | awk '{$1=$1; print}')
if [ -z "$STACK_NAMES" ]; then
  echo "No stack specified. Try: ./run.sh --list" >&2
  exit 2
fi

# ── Resolve services ─────────────────────────────────────────────────
# core is implicitly added to any non-infra, non-all stack.

want_core=0
for s in $STACK_NAMES; do
  case "$s" in
    infra|all|core) ;;
    *) want_core=1 ;;
  esac
done

RESOLVED=""
if [ "$want_core" -eq 1 ]; then
  RESOLVED=$(stack_services core)
fi
for s in $STACK_NAMES; do
  RESOLVED="$RESOLVED
$(stack_services "$s")"
done

# Dedupe + drop blanks
SERVICES=$(echo "$RESOLVED" | awk 'NF' | sort -u)

# ── Build the docker compose invocation ──────────────────────────────
#
# Stacking multiple `-f` files makes docker compose resolve every relative
# path (like `build: .`) against the FIRST -f file's directory. That breaks
# service overrides that expect `build: .` == "this service's directory".
#
# Workaround: generate a small orchestrator file at the workspace root that
# uses `include:` to import each real compose file. `include:` resolves each
# import's paths relative to its own directory, which is what we want.

TMPFILE="$REPO_ROOT/.run-orchestrator.compose.yml"
{
  echo "# Auto-generated by infra/run.sh. Safe to delete."
  echo "include:"
  echo "  - path: $INFRA_DIR/docker-compose.yml"
  skipped=""
  for name in $SERVICES; do
    dir="$(service_dir "$name")"
    if [ -f "$REPO_ROOT/$dir/docker-compose.override.yml" ]; then
      echo "  - path: $dir/docker-compose.override.yml"
    else
      skipped="$skipped $name"
    fi
  done
} > "$TMPFILE"

COMPOSE_ARGS="-p $PROJECT_NAME --project-directory $REPO_ROOT -f $TMPFILE"

# ── Run ──────────────────────────────────────────────────────────────

count=$(echo "$SERVICES" | awk 'NF' | wc -l | tr -d ' ')

echo "==> stacks:   $STACK_NAMES"
echo "==> command:  $COMMAND"
echo "==> services: $count"
if [ -n "$skipped" ]; then
  echo "==> skipped (no compose override):$skipped"
fi

# shellcheck disable=SC2086
case "$COMMAND" in
  up)
    docker compose $COMPOSE_ARGS up -d
    echo
    echo "==> ensuring kafka topics exist …"
    docker compose $COMPOSE_ARGS up kafka-init 2>&1 | tail -5 || true
    echo
    docker compose $COMPOSE_ARGS ps --format 'table {{.Service}}\t{{.Ports}}\t{{.Status}}'
    ;;
  down)
    docker compose $COMPOSE_ARGS down
    ;;
  logs)
    docker compose $COMPOSE_ARGS logs -f --tail=100
    ;;
  ps)
    docker compose $COMPOSE_ARGS ps
    ;;
  restart|pull|build)
    docker compose $COMPOSE_ARGS "$COMMAND"
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    exit 2
    ;;
esac
