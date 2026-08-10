# healthcare-org

A production-shaped healthcare platform built as **101 independently-deployable services** talking over **HTTP + Kafka**, plus **7 event-driven integrations into an external ERP** (`buildwithtalia/erp-*`).

This repo — `healthcare-infra` — is the meta repo. It holds the shared infrastructure (docker-compose, Kafka topics, service registry) that every service consumes. Each service lives in its own repository under [`github.com/healthcare-org-app`](https://github.com/healthcare-org-app).

---

## Table of contents

- [At a glance](#at-a-glance)
- [Architecture](#architecture)
- [Repositories](#repositories)
- [Infrastructure](#infrastructure)
- [Service catalog](#service-catalog)
- [Event bus (Kafka)](#event-bus-kafka)
- [Cross-service interdependencies](#cross-service-interdependencies)
- [ERP integration](#erp-integration)
- [Shared runtime library](#shared-runtime-library)
- [Adding a service](#adding-a-service)
- [Local development](#local-development)
- [Testing](#testing)

---

## At a glance

| Metric | Value |
|---|---|
| Total services | **101** |
| Languages | Python (94), Go (4), Node (3) |
| Repos in `healthcare-org-app` | **104** (101 services + 3 meta) |
| External peers wired | 9 (ERP microservices under `buildwithtalia/erp-*`) |
| Kafka topics | 25 |
| Total HTTP dependency edges declared | **285** |
| Total event-subscription edges | **107** |
| Databases (Postgres, one per domain) | 15 |
| Tests passing | 100% of Python services (94/94) |

## Architecture

Each service:

- owns its own **Postgres database** (JSONB-per-row where appropriate),
- exposes a **Flask HTTP API** with a shared `/health`, `/ready`, and JWT-guarded resource routes,
- **publishes** domain events and **subscribes** to peer events over Kafka,
- calls sibling services via a shared **retry + circuit-breaker HTTP client**, and
- writes to a single append-only `audit.event` stream consumed by `audit-log-service`.

```
                       ┌────────────────────────────────┐
                       │       External clients         │
                       └───────────────┬────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │        api-gateway (Go)             │
                    └──────────────────┬──────────────────┘
                                       │
        ┌──────────────────────────────┴───────────────────────────────┐
        │                                                              │
   ┌────┴────┐  ┌──────────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌──────┴──────┐
   │identity │  │ patients │  │  ehr  │  │  lab  │  │pharmacy│  │  billing …   │
   │  -service│  │ -service │  │ -svc  │  │ -svc  │  │ -svc   │  │              │
   └────┬────┘  └────┬─────┘  └───┬───┘  └───┬───┘  └───┬────┘  └──────┬──────┘
        │           │             │          │          │              │
        └───────────┴─────────────┴──────────┴──────────┴──────────────┘
                                    ▼
                          ┌───────────────────┐
                          │  Kafka topics ×25 │
                          └────────┬──────────┘
                                   │
                       ┌───────────┴────────────┐
                       │  erp-bridge-service    │  Kafka → HTTP translation
                       └───────────┬────────────┘
                                   │
      ┌──────────────┬─────────────┼─────────────┬──────────────┐
      │              │             │             │              │
   erp-hr    erp-accounting   erp-payroll   erp-inventory   erp-procurement …
    (external, buildwithtalia/erp-*)
```

## Repositories

Three **meta** repos:

- **[`healthcare-org-app/healthcare-infra`](https://github.com/healthcare-org-app/healthcare-infra)** *(this repo)* — docker-compose, Kafka topic catalog, service registry
- **[`healthcare-org-app/healthcare-common`](https://github.com/healthcare-org-app/healthcare-common)** — shared Python runtime library (HTTP client, event bus, JWT auth, tracing, DB pool, audit publisher, bootstrap)
- **[`healthcare-org-app/healthcare-tools`](https://github.com/healthcare-org-app/healthcare-tools)** — scaffold generator + per-service customizations

Plus **101 service repos**, one per service (see [Service catalog](#service-catalog)). Repos are named with the `healthcare-` prefix; the `-service` suffix is stripped. Local checkout structure:

```
~/Postman/healthcare-org/
├── infra/                          # → healthcare-infra
├── libs/py-healthcare-common/      # → healthcare-common
├── tools/                          # → healthcare-tools
└── services/
    ├── patients-service/           # → healthcare-patients   (golden reference)
    ├── erp-bridge-service/         # → healthcare-erp-bridge (integration seam)
    ├── auth-service/               # → healthcare-auth
    ├── ehr-service/                # → healthcare-ehr
    ├── ...                         # 97 more
```

## Infrastructure

Everything the services need to run is in this repo's `docker-compose.yml`:

| Container | Purpose | Port |
|---|---|---|
| `postgres` | Per-domain databases (15 of them, listed in `POSTGRES_MULTIPLE_DATABASES`) | 5432 |
| `zookeeper` | Kafka coordination | — |
| `kafka` | Event bus. Topics auto-created from `topics.yaml` at bring-up. | 9092 / 29092 |
| `kafka-init` | One-shot topic creator | — |
| `redis` | Cache + rate-limit backend for the gateway and auth | 6379 |
| `service-registry` (Consul) | Service discovery | 8500 |

The Postgres init script (`seed/init-databases.sh`) creates one database per healthcare domain: `identity`, `auth`, `patients`, `providers`, `ehr`, `lab`, `imaging`, `pharmacy`, `insurance`, `claims`, `billing`, `notifications`, `devices`, `ai_agents`, `audit`.

**Bring up:**

```bash
docker compose up -d postgres kafka zookeeper redis service-registry
docker compose up kafka-init          # one-shot: creates topics from topics.yaml
```

## Service catalog

All 101 services are declared in `registry.yaml`. One row per service:

| Port | Service | Language |
|------|---------|----------|
| **PLATFORM** | | |
| 8000 | `api-gateway` | Go |
| 8001 | `identity-service` | Python |
| 8002 | `auth-service` | Python |
| 8003 | `authorization-service` | Python |
| 8004 | `service-registry` | Go |
| 8005 | `config-service` | Python |
| 8006 | `secrets-vault` | Python |
| 8007 | `audit-log-service` | Python |
| 8008 | `feature-flags-service` | Python |
| 8009 | `tenancy-service` | Python |
| **PATIENTS** | | |
| 8100 | `patients-service` | Python |
| 8101 | `demographics-service` | Python |
| 8102 | `patient-consent-service` | Python |
| 8103 | `patient-preferences-service` | Python |
| 8104 | `patient-portal-api` | Node |
| 8105 | `patient-relationships-service` | Python |
| 8106 | `patient-timeline-service` | Python |
| 8107 | `patient-search-service` | Python |
| 8108 | `patient-merge-service` | Python |
| 8109 | `patient-communications-service` | Python |
| **PROVIDERS** | | |
| 8200 | `providers-service` | Python |
| 8201 | `credentialing-service` | Python |
| 8202 | `licensing-service` | Python |
| 8203 | `specialties-service` | Python |
| 8204 | `provider-schedule-service` | Python |
| 8205 | `on-call-service` | Python |
| 8206 | `provider-directory` | Python |
| 8207 | `provider-portal-api` | Node |
| 8208 | `provider-performance-service` | Python |
| **CLINICAL / EHR** | | |
| 8300 | `ehr-service` | Python |
| 8301 | `encounters-service` | Python |
| 8302 | `clinical-notes-service` | Python |
| 8303 | `problem-list-service` | Python |
| 8304 | `med-reconciliation-service` | Python |
| 8305 | `allergies-service` | Python |
| 8306 | `immunizations-service` | Python |
| 8307 | `vitals-service` | Python |
| 8308 | `cpoe-service` | Python |
| 8309 | `care-plan-service` | Python |
| 8310 | `referrals-service` | Python |
| 8311 | `discharge-summary-service` | Python |
| 8312 | `clinical-decision-support` | Python |
| 8313 | `diagnosis-codes-service` | Python |
| 8314 | `care-teams-service` | Python |
| **DIAGNOSTICS** | | |
| 8400 | `lab-orders-service` | Python |
| 8401 | `lab-results-service` | Python |
| 8402 | `imaging-orders-service` | Python |
| 8403 | `imaging-results-service` | Python |
| 8404 | `pathology-service` | Python |
| 8405 | `radiology-worklist` | Python |
| 8406 | `specimen-tracking-service` | Python |
| 8407 | `reference-ranges-service` | Python |
| **PHARMACY** | | |
| 8500 | `pharmacy-service` | Python |
| 8501 | `prescriptions-service` | Python |
| 8502 | `refills-service` | Python |
| 8503 | `drug-interactions-service` | Python |
| 8504 | `formulary-service` | Python |
| 8505 | `pharmacy-inventory-service` | Python |
| 8506 | `dispensing-service` | Python |
| **SCHEDULING** | | |
| 8600 | `appointments-service` | Python |
| 8601 | `appointment-slots-service` | Python |
| 8602 | `reminders-service` | Python |
| 8603 | `waitlist-service` | Python |
| 8604 | `room-booking-service` | Python |
| **BILLING / RCM** | | |
| 8700 | `billing-service` | Python |
| 8701 | `charge-capture-service` | Python |
| 8702 | `coding-service` | Python |
| 8703 | `claims-submission-service` | Python |
| 8704 | `claims-adjudication-service` | Python |
| 8705 | `denials-service` | Python |
| 8706 | `invoicing-service` | Python |
| 8707 | `payments-service` | Python |
| 8708 | `statements-service` | Python |
| 8709 | `collections-service` | Python |
| **INSURANCE** | | |
| 8800 | `eligibility-service` | Python |
| 8801 | `prior-auth-service` | Python |
| 8802 | `coverage-verification-service` | Python |
| 8803 | `payer-directory` | Python |
| 8804 | `payer-edi-connect` | Python |
| 8805 | `claims-status-service` | Python |
| **DEVICES / IOT** | | |
| 8900 | `device-registry-service` | Python |
| 8901 | `device-telemetry-service` | Go |
| 8902 | `device-alerts-service` | Python |
| 8903 | `device-fleet-service` | Python |
| 8904 | `remote-monitoring-service` | Python |
| **COMMUNICATIONS** | | |
| 9000 | `notifications-service` | Python |
| 9001 | `sms-gateway-service` | Go |
| 9002 | `email-gateway-service` | Python |
| 9003 | `push-gateway-service` | Python |
| 9004 | `secure-messaging-service` | Node |
| **AI / ANALYTICS** | | |
| 9100 | `ai-agents-service` | Python |
| 9101 | `ai-invocations-service` | Python |
| 9102 | `analytics-events-service` | Python |
| 9103 | `reporting-service` | Python |
| 9104 | `ml-models-service` | Python |
| **FACILITY / OPS** | | |
| 9200 | `facilities-service` | Python |
| 9201 | `wards-beds-service` | Python |
| 9202 | `equipment-service` | Python |
| 9203 | `sterile-supply-service` | Python |
| 9204 | `maintenance-service` | Python |
| **INTEGRATION** | | |
| 9300 | `erp-bridge-service` | Python |

**External peers** (not part of the healthcare-org fleet — code lives in `buildwithtalia/erp-*`):

| Port | Service |
|------|---------|
| 3010 | `erp-gateway` |
| 3011 | `erp-hr` |
| 3012 | `erp-payroll` |
| 3013 | `erp-accounting` |
| 3014 | `erp-inventory` |
| 3015 | `erp-supply-chain` |
| 3016 | `erp-procurement` |
| 3017 | `erp-finance` |
| 3018 | `erp-billing` |

Full details (per-service HTTP deps, publishes, subscribes) are in [`registry.yaml`](registry.yaml).

## Event bus (Kafka)

25 topics defined in `topics.yaml`. Grouped by domain:

**Identity / access**
`identity.user.created`, `identity.user.deactivated`, `auth.session.started`

**Patients**
`patient.created`, `patient.updated`, `patient.merged`, `patient.consent.updated`

**Encounters / clinical**
`encounter.started`, `encounter.ended`, `order.placed`

**Diagnostics**
`lab.result.available`, `imaging.result.available`

**Pharmacy**
`prescription.issued`, `prescription.refill_requested`

**Scheduling**
`appointment.booked`, `appointment.cancelled`

**Billing / claims**
`charge.captured`, `claim.submitted`, `claim.adjudicated`, `invoice.issued`, `invoice.paid`

**Devices**
`device.reading` (24 partitions — high volume), `device.alert.triggered`

**Comms**
`notification.requested`

**Audit (every service produces)**
`audit.event`

Partitions, retention, producers, and consumers per topic are declared in `topics.yaml` — that file is the source of truth the `kafka-init` container reads to create topics.

## Cross-service interdependencies

The platform is genuinely interdependent, not just co-hosted. All the following counts are grepable in the code.

### HTTP dependency graph

**285 declared edges** across 101 services. Every service declares its peers in `service.yaml`; the shared runtime (`healthcare-common.bootstrap.create_service`) reads that file and pre-provisions a `ServiceClient` per peer at boot time.

Most-depended-on services (HTTP fan-in):

| Fan-in | Service |
|--------|---------|
| 94 | `audit-log-service` (every service writes audit) |
| 36 | `patients-service` |
| 21 | `providers-service` |
| 12 | `notifications-service`, `ehr-service` (tied) |
| 8 | `auth-service` |
| 5 | `prescriptions-service`, `invoicing-service`, `secrets-vault` |
| 4 | `identity-service` |

**44 services** make **real HTTP calls to peers inside their POST /create handlers** (best-effort validation/enrichment — degrades gracefully via the circuit breaker if a peer is down).

Sample:

- `ehr-service.POST` — validates `patient_id` against `patients-service` and `provider_id` against `providers-service` before writing.
- `appointments-service.POST` — same, plus room + slot resolution.
- `prescriptions-service.POST` — additionally checks against `drug-interactions-service` and `formulary-service`.
- `claims-submission-service.POST` — validates coverage via `coverage-verification-service`.
- `providers-service.POST` — cross-system: validates `employee_id` against **`erp-hr`**.

### Event flows

**49 services** have at least one **real** Kafka handler (writes to their own DB and/or publishes follow-up events, not just a log stub). **~90 handler bodies** total do meaningful work.

Notable end-to-end chains that flow through code today:

- **Patient onboarding**
  `patient.created` → **9 subscribers** react:
  - `eligibility-service` seeds a pending eligibility check
  - `patient-consent-service` seeds a HIPAA consent record
  - `patient-preferences-service` seeds default preferences
  - `patient-communications-service` publishes a welcome `notification.requested`
  - `patient-timeline-service`, `patient-search-service`, `patient-relationships-service`, `ehr-service` snapshot the patient locally
  - `analytics-events-service` records the event

- **Encounter → billing chain**
  `encounter.ended` → `charge-capture-service` builds a charge → publishes `charge.captured` → `claims-submission-service` builds and submits a claim → publishes `claim.submitted` → `claims-adjudication-service` adjudicates → publishes `claim.adjudicated` → `invoicing-service` computes patient responsibility → publishes `invoice.issued` → `notifications-service` sends a statement → gateway services deliver.

- **Payment closes the loop**
  `POST /api/payments/pay` → publishes `invoice.paid` → `invoicing-service` marks the invoice paid + `statements-service` timestamps the statement + `collections-service` closes any open case + `notifications-service` confirms receipt + `analytics-events-service` records it + **`erp-bridge-service`** posts revenue to `erp-accounting` GL.

- **Device alerting**
  `device.reading` → `device-alerts-service` checks thresholds → publishes `device.alert.triggered` → `care-teams-service` opens a case + `notifications-service` pages the on-call + `remote-monitoring-service` retains the alert.

- **Appointment lifecycle**
  `appointment.booked` → `reminders-service` schedules + `appointment-slots-service` marks slot booked + `provider-schedule-service` blocks time + `room-booking-service` allocates + `notifications-service` confirms.
  `appointment.cancelled` → `waitlist-service` offers the slot to the next candidate + `appointment-slots-service` frees it + `provider-schedule-service` unblocks + `notifications-service` sends cancellation.

- **Patient merge propagation**
  `patient.merged` → `ehr-service`, `patient-timeline-service`, `patient-search-service`, `patient-relationships-service`, `billing-service`, `claims-submission-service`, `audit-log-service` all update their local snapshots to point at the new patient id.

### Audit trail

Every mutating handler across all 101 services publishes `audit.event`. `audit-log-service` is the single consumer and durably persists them. Volume in a busy day easily exceeds 10× the volume of business events — hence 24 partitions and 90-day retention on that topic alone.

## ERP integration

healthcare-org talks to the existing ERP microservices at `github.com/buildwithtalia/erp-*` (HR, Payroll, Accounting, Inventory, Procurement, Supply Chain, Finance, Billing, Gateway) in **two directions**:

### 1. Async: `erp-bridge-service` (port 9300)

New service that translates 7 healthcare Kafka events into HTTP calls to the appropriate ERP module:

| Healthcare event | → ERP call |
|---|---|
| `invoice.paid` | `POST erp-accounting/api/accounting/journal-entries` (revenue posting) |
| `claim.adjudicated` | `POST erp-accounting/api/accounting/journal-entries` (insurance receivable) |
| `encounter.ended` | `POST erp-payroll/api/payroll/encounter-credit` (provider credit) |
| `prescription.issued` | `POST erp-inventory/api/inventory/consume` (drug SKU decrement) |
| `device.reading` | `POST erp-supply-chain/api/supply-chain/telemetry` (sampled) |
| `patient.merged` | `POST erp-billing/api/billing/reconcile-merge` |
| `identity.user.created` | `POST erp-hr/api/hr/employees` (staff-role provisioning) |

Every outbound call is retried and circuit-broken; failures publish `erp.posting.failed`, successes publish `erp.posting.completed`. The healthcare transaction is never blocked by ERP.

The bridge also exposes a small callback surface for ERP to look healthcare state up:

- `GET /api/erp-bridge/provider/<id>` — resolve a healthcare provider
- `GET /api/erp-bridge/patient/<id>` — resolve a patient
- `GET /api/erp-bridge/postings` — bridge activity ledger (ops surface)

### 2. Sync: direct HTTP validations

Three healthcare services validate against ERP inline on create:

| Service | Peer | Validates on POST |
|---|---|---|
| `providers-service` | `erp-hr` | `employee_id` — hydrate provider with HR record |
| `equipment-service` | `erp-inventory` | `sku` — verify the asset class exists |
| `sterile-supply-service` | `erp-procurement` | `vendor_id` — verify the vendor |

### 3. ERP-side: `erp-hr` consumes `identity.user.created`

The `buildwithtalia/erp-hr` repo has been extended with a Kafka consumer (`src/identity_consumer.py`) that subscribes to healthcare's `identity.user.created` topic. When a user is created with a staff role (provider, clinician, nurse, employee, staff), erp-hr auto-provisions a matching employee record. Idempotent by email. Opt-in via `KAFKA_BOOTSTRAP` env var — silently skipped in dev without Kafka.

## Shared runtime library

Every Python service imports `healthcare_common` (published as `py-healthcare-common`, sourced from the meta repo `healthcare-common`). It bundles:

| Module | Purpose |
|---|---|
| `http` | `ServiceClient` — retry + jitter + circuit breaker, `X-Request-ID` propagation |
| `events` | `EventBus` — Kafka producer + background consumer thread with graceful shutdown |
| `auth` | `verify_jwt`, `@require_auth(scopes=[...])` Flask decorator |
| `tracing` | Correlation-id middleware (auto-generates/echoes `X-Request-ID`, threads it into HTTP + Kafka) |
| `db` | `db_pool()` — psycopg connection pool + `query`, `query_one`, `execute` helpers |
| `audit` | `emit_audit(bus, action=..., actor=..., target=...)` — never raises |
| `bootstrap` | `create_service(name)` — reads `service.yaml`, wires Flask + Kafka + DB + peer `ServiceClient`s, registers `/health` and `/ready` |

A typical service main file is ~15 lines:

```python
from healthcare_common.bootstrap import create_service
from .schema import create_tables
from .routes import build_blueprint
from .consumers import register as register_consumers

def build():
    svc = create_service("appointments-service")
    create_tables(svc.db)
    svc.app.register_blueprint(build_blueprint(svc))
    register_consumers(svc)
    return svc

svc = build()
app = svc.app

if __name__ == "__main__":
    svc.run()
```

## Adding a service

1. Add the service to `registry.yaml` with a fresh port and its HTTP/event dependencies.
2. Add any new Kafka topics to `topics.yaml`.
3. Optionally add per-service customizations to `tools/customizations.py` (peer validation calls, real consumer handler bodies).
4. Generate the scaffold: `python tools/scaffold.py` (idempotent — only writes services that don't already have a directory; use `--force` to regenerate everything except `patients-service` which is protected as the hand-written reference).
5. `git init` + initial commit in the new service directory.
6. `gh repo create healthcare-org-app/healthcare-<name> --source . --push --public`.

The scaffold produces the full service (Flask app, Docker, docker-compose override, service.yaml, tests, CI workflow, README, .env.example) matching every other service's shape.

## Running the platform with Docker

### Prerequisites

- **Docker Desktop** running (verify: `docker info` returns without error).
- Bandwidth for the first build (base image `python:3.11-slim` + `pip install` per service). Plan on 5–15 min for the `core` stack; 45+ min for `all`.
- ≥8 GB free RAM for `core`; ~20 GB+ for `clinical`+`billing`+`insurance`. `all` (94 Python + 4 Go + 3 Node services simultaneously) needs 40 GB+ and isn't the intended dev flow.

### Bring up a stack

`infra/run.sh` orchestrates any subset of the fleet on top of the shared containers. Stacks are additive (they union) and `core` is included implicitly by any non-`infra` stack.

```bash
cd ~/Postman/healthcare-org/infra

./run.sh --list                   # see available stacks
./run.sh core                     # infra + 7 baseline services (identity, auth, patients, ...)
./run.sh clinical                 # core + EHR/labs/pharmacy/appointments/imaging
./run.sh billing insurance        # core + billing + insurance (unioned)
./run.sh all                      # attempts every service — heavy, may OOM

./run.sh core down                # stop
./run.sh clinical logs            # tail logs
./run.sh core ps                  # status
./run.sh --help                   # more
```

Under the hood, `run.sh` generates a temporary orchestrator compose file at the workspace root (`.run-orchestrator.compose.yml`, gitignored) that uses Docker Compose's `include:` directive so each service's `build: .` resolves against **that service's directory** — not the base compose file's — regardless of how many stacks are unioned.

### Available stacks

| Stack | Contains | Services |
|---|---|---|
| `infra` | Shared containers only | postgres, kafka, zookeeper, redis, consul, kafka-init |
| `core` | infra + platform baseline | identity-service (8001), auth-service (8002), authorization-service (8003), audit-log-service (8007), patients-service (8100), providers-service (8200), notifications-service (9000) |
| `clinical` | core + clinical workflows | ehr, encounters, cpoe, appointments, lab-orders/results, imaging-orders/results, prescriptions, pharmacy (10 services) |
| `billing` | core + revenue cycle | billing, charge-capture, claims-submission, claims-adjudication, denials, invoicing, payments, statements, collections (9 services) |
| `insurance` | core + payer flows | eligibility, prior-auth, coverage-verification, payer-directory, payer-edi-connect, claims-status (6 services) |
| `devices` | core + IoT | device-registry, device-telemetry, device-alerts, device-fleet, remote-monitoring, vitals (6 services) |
| `comms` | core + communication | sms-gateway, email-gateway, push-gateway, patient-communications, secure-messaging (5 services) |
| `erp-bridge` | core + integration | erp-bridge-service (9300). ERP itself must run separately at ports 3010–3018. |
| `all` | Every service | all 94 Python + Go + Node services |

### Verify a stack is up

Every service exposes `GET /health` on its own port. Quick check for the `core` stack:

```bash
for port in 8001 8002 8003 8007 8100 8200 9000; do
  echo -n "$port: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$port/health
done
# → all 200 when healthy
```

Try a real request (auth is disabled in dev via `AUTH_DISABLED=1`):

```bash
# create a patient
curl -X POST http://127.0.0.1:8100/api/patients/ \
  -H 'Content-Type: application/json' \
  -d '{"first_name":"Ada","last_name":"Lovelace","dob":"1815-12-10"}'

# read it back
curl http://127.0.0.1:8100/api/patients/
```

Every mutation emits an event. Inspect topics:

```bash
docker exec -it healthcare_kafka \
  kafka-console-consumer --bootstrap-server kafka:9092 \
    --topic patient.created --from-beginning --max-messages 5
```

### Data persistence

The shared containers keep data in named Docker volumes: `healthcare-org_postgres_data`, `healthcare-org_kafka_data`, `healthcare-org_redis_data`. Ordinary `./run.sh <stack> down` keeps volumes. **Warning:** if you change Kafka/ZK versions or wipe ZK without wiping Kafka, brokers refuse to start with `InconsistentClusterIdException`. In that case:

```bash
./run.sh <stack> down                   # stop containers
docker compose -p healthcare-org down --volumes   # nuke data
./run.sh <stack>                        # fresh start
```

### Iterating on service code

The shared library is bind-mounted into each container at `/opt/py-healthcare-common` (read-only). Changes to `libs/py-healthcare-common/` take effect on the next container start — no image rebuild needed.

Service code (`app/`) is baked into the image at build time. After editing a service's code, rebuild just that service:

```bash
cd ~/Postman/healthcare-org
docker compose -p healthcare-org --project-directory . \
  -f .run-orchestrator.compose.yml build <service-name>
docker compose -p healthcare-org --project-directory . \
  -f .run-orchestrator.compose.yml up -d <service-name>
```

## Local development without Docker

For fast iteration on a single service:

```bash
git clone https://github.com/healthcare-org-app/healthcare-common ~/Postman/healthcare-org/libs/py-healthcare-common
git clone https://github.com/healthcare-org-app/healthcare-patients ~/Postman/healthcare-org/services/patients-service

# Bring up JUST the infra
cd ~/Postman/healthcare-org/infra
./run.sh infra

# Run the service on the host
cd ~/Postman/healthcare-org/services/patients-service
python -m venv .venv && source .venv/bin/activate
pip install -e ../../libs/py-healthcare-common
pip install -r requirements.txt
cp .env.example .env
python -m app.main
```

The circuit breaker in `ServiceClient` degrades gracefully when a peer is absent, so partial stacks stay stable.

## Testing

Every Python service ships with tests that stub Postgres and Kafka via a fake DB + fake event bus (`tests/conftest.py`). Tests don't require any infra to be running.

```bash
cd services/<name>
pytest
```

CI (`.github/workflows/ci.yml`) runs the same test suite on push and PR.

Current state: **94/94** Python services pass their tests (280+ tests total across the fleet).
