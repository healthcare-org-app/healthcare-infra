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

All 101 services are declared in `registry.yaml`. Port ranges group services by domain:

| Range | Domain | Count | Examples |
|-------|--------|-------|----------|
| 8000–8009 | **Platform** | 10 | `identity-service`, `auth-service`, `authorization-service`, `api-gateway` (Go), `audit-log-service`, `service-registry` (Go), `config-service`, `secrets-vault`, `feature-flags-service`, `tenancy-service` |
| 8100–8109 | **Patients** | 10 | `patients-service`, `demographics-service`, `patient-consent-service`, `patient-preferences-service`, `patient-portal-api` (Node), `patient-relationships-service`, `patient-timeline-service`, `patient-search-service`, `patient-merge-service`, `patient-communications-service` |
| 8200–8208 | **Providers** | 9 | `providers-service`, `credentialing-service`, `licensing-service`, `specialties-service`, `provider-schedule-service`, `on-call-service`, `provider-directory`, `provider-portal-api` (Node), `provider-performance-service` |
| 8300–8314 | **Clinical / EHR** | 15 | `ehr-service`, `encounters-service`, `clinical-notes-service`, `problem-list-service`, `med-reconciliation-service`, `allergies-service`, `immunizations-service`, `vitals-service`, `cpoe-service`, `care-plan-service`, `referrals-service`, `discharge-summary-service`, `clinical-decision-support`, `diagnosis-codes-service`, `care-teams-service` |
| 8400–8407 | **Diagnostics** | 8 | `lab-orders-service`, `lab-results-service`, `imaging-orders-service`, `imaging-results-service`, `pathology-service`, `radiology-worklist`, `specimen-tracking-service`, `reference-ranges-service` |
| 8500–8506 | **Pharmacy** | 7 | `pharmacy-service`, `prescriptions-service`, `refills-service`, `drug-interactions-service`, `formulary-service`, `pharmacy-inventory-service`, `dispensing-service` |
| 8600–8604 | **Scheduling** | 5 | `appointments-service`, `appointment-slots-service`, `reminders-service`, `waitlist-service`, `room-booking-service` |
| 8700–8709 | **Billing / RCM** | 10 | `billing-service`, `charge-capture-service`, `coding-service`, `claims-submission-service`, `claims-adjudication-service`, `denials-service`, `invoicing-service`, `payments-service`, `statements-service`, `collections-service` |
| 8800–8805 | **Insurance** | 6 | `eligibility-service`, `prior-auth-service`, `coverage-verification-service`, `payer-directory`, `payer-edi-connect`, `claims-status-service` |
| 8900–8904 | **Devices / IoT** | 5 | `device-registry-service`, `device-telemetry-service` (Go), `device-alerts-service`, `device-fleet-service`, `remote-monitoring-service` |
| 9000–9004 | **Communications** | 5 | `notifications-service`, `sms-gateway-service` (Go), `email-gateway-service`, `push-gateway-service`, `secure-messaging-service` (Node) |
| 9100–9104 | **AI / Analytics** | 5 | `ai-agents-service`, `ai-invocations-service`, `analytics-events-service`, `reporting-service`, `ml-models-service` |
| 9200–9204 | **Facility / Ops** | 5 | `facilities-service`, `wards-beds-service`, `equipment-service`, `sterile-supply-service`, `maintenance-service` |
| 9300 | **Integration** | 1 | `erp-bridge-service` |

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

## Local development

Bring up the shared infra once:

```bash
git clone https://github.com/healthcare-org-app/healthcare-infra ~/healthcare-org/infra
cd ~/healthcare-org/infra
docker compose up -d postgres kafka zookeeper redis service-registry kafka-init
```

Then, for any service:

```bash
git clone https://github.com/healthcare-org-app/healthcare-common ~/healthcare-org/libs/py-healthcare-common
git clone https://github.com/healthcare-org-app/healthcare-patients ~/healthcare-org/services/patients-service

cd ~/healthcare-org/services/patients-service
python -m venv .venv && source .venv/bin/activate
pip install -e ../../libs/py-healthcare-common
pip install -r requirements.txt
cp .env.example .env
python -m app.main
```

Running 100+ services on one laptop is not the intended workflow; bring up only the ones you're touching plus their direct peers. The circuit breaker in `ServiceClient` degrades gracefully when a peer is absent.

## Testing

Every Python service ships with tests that stub Postgres and Kafka via a fake DB + fake event bus (`tests/conftest.py`). Tests don't require any infra to be running.

```bash
cd services/<name>
pytest
```

CI (`.github/workflows/ci.yml`) runs the same test suite on push and PR.

Current state: **94/94** Python services pass their tests (280+ tests total across the fleet).
