# Real services vs Postman api-simulation

This report measures how many tokens, how much time and how much money an AI coding agent uses to prove four API services work end to end, when it either brings up the real dependencies itself (Docker Postgres, real services, the PayPal sandbox) or uses mocks already built with the Postman api-simulation skill. It matters because an agent re-reads its whole conversation on every step, so the setup it has to do for slow, costly or unavailable dependencies directly drives the cost and speed of testing against them. Across the four services, the api-simulation skill used 50% fewer input tokens (12.96M against 26.09M), 39% fewer output tokens, took 47% less time and cost 42% less ($7.52 against $12.94), though that leaves out the one-time cost of building the mocks and comes from one run per service.

Final runs on `healthcare-infra`. Each row is one headless `claude -p` session (model `claude-sonnet-5`) given the same task for one service: run the handler locally, write an end-to-end Postman collection (success, not found or invalid input, dependency failure, outage), run it with the Postman CLI until it passes, and stop everything.

- **Real** means the agent brings up the real dependencies itself in Docker. Insurance claims uses the real patients and claims-submission services built from the `healthcare-org-app` repos with Postgres. Invoicing, prescription refill and appointment check-in use a real Postgres with PostgREST (the repo schema), and invoicing also calls the PayPal sandbox.
- **api-simulation skill** means the Postman api-simulation skill with the simulations and mocks already built before the run, so building them is not counted. The agent uses them.

## Results

| Service | Approach | Time | Turns | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|---|
| **Insurance claims** | Real | 6m 48s | 74 | 3.61M | 26.4k | $2.16 |
|  | api-simulation skill | 3m 55s | 53 | 2.69M | 21.4k | $1.71 |
| **Invoicing (PayPal + Supabase)** | Real | 10m 23s | 108 | 9.59M | 47.7k | $4.34 |
|  | api-simulation skill | 5m 38s | 61 | 3.43M | 27.7k | $2.09 |
| **Prescription refill (Supabase)** | Real | 8m 42s | 74 | 5.30M | 40.8k | $2.78 |
|  | api-simulation skill | 4m 09s | 49 | 2.66M | 20.3k | $1.57 |
| **Appointment check-in (Supabase)** | Real | 8m 49s | 75 | 7.60M | 40.1k | $3.65 |
|  | api-simulation skill | 4m 50s | 82 | 4.19M | 25.0k | $2.15 |

## Totals over the four services

| Approach | Time | Turns | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|
| Real | 34m 42s | 331 | 26.09M | 155.0k | $12.94 |
| api-simulation skill | 18m 32s | 245 | 12.96M | 94.3k | $7.52 |
| **api-simulation skill vs real** | **-47%** | **-26%** | **-50%** | **-39%** | **-42%** |

## What each workflow does

In both approaches the code under test, the service's handler under `frontend/api/`, runs on the host with `node scripts/dev-host.mjs` on port 4400, so the same code is tested each time. Only its dependencies differ. In every run the agent then writes the e2e Postman collection (success, not found or invalid input, dependency failure) and a separate outage collection, runs them with the Postman CLI until they pass, and stops everything it started.

### Insurance claims (`GET /api/insurance/claims/{id}`)

Looks up a claim in claims-submission-service, then the patient in patients-service, and returns the combined record.

- **Real:** builds Docker images for the real **patients-service** (port 8100) and **claims-submission-service** (port 8703) from the cloned `healthcare-org-app` repos, with the shared `healthcare-common` library installed from the local clone. Starts a **Postgres** container with a `patients` and a `claims` database and puts all three on one Docker network. Seeds claims through the real API (one for an existing patient, one for an unknown patient). Points the handler at both services with `CLAIMS_API_URL` and `PATIENTS_API_URL`. The outage case stops the patients container.
- **api-simulation skill:** reuses the repo's generated `hc-claims-submission` and `hc-patients` mocks with two simulation files (normal, and one that forces the claims member to return 500). `postman collection run --simulation` starts and stops the simulation around each collection run.

### Invoicing (`POST /api/invoicing/{id}/send`, `GET /api/invoicing/{id}/payment-status`)

Reads the invoice and patient from the database, creates and sends a PayPal invoice, writes the PayPal id back and inserts a notification. Payment status reads the row and asks PayPal for the invoice state.

- **Real:** starts a **Postgres 16** container loaded from the repo's `supabase-schema.sql` with the Supabase roles added by hand, a **PostgREST** container in front of it, and a small Node proxy on the host (Supabase's client always calls `/rest/v1/...` and PostgREST does not serve that path). Mints a service-role JWT locally. Calls the real **PayPal sandbox** API with sandbox credentials. The outage case stops the database containers.
- **api-simulation skill:** reuses a stateful mock of the database's REST API (invoicing, patients, payments and notifications tables) and a mock of PayPal's token and invoice calls, with a normal simulation and an outage simulation that forces PayPal to return 502.

### Prescription refill (`POST /api/prescriptions/{id}/refill`)

Reads the prescription, rejects a cancelled one or one with no refills left, inserts a refill row and decrements the remaining count.

- **Real:** starts a **Postgres** container loaded from `supabase-schema.sql` with the Supabase roles, a **PostgREST** container, and the host proxy. The collection seeds its own fixture rows. The outage case stops the PostgREST container.
- **api-simulation skill:** reuses a stateful PostgREST stand-in for the prescriptions and refills tables, with a normal member and a `db-down` member that returns 500.

### Appointment check-in (`POST /api/appointments/{id}/check-in`)

Reads the appointment's status, validates the status change with the business rules, and updates the row to checked-in.

- **Real:** starts a **Postgres** container loaded from `supabase-schema.sql` with the Supabase roles, a **PostgREST** container, and the host proxy; a fixture-reset request restores the appointment rows before each check. The outage case stops the database.
- **api-simulation skill:** reuses a PostgREST stand-in for the appointments table (an active row, a completed row for the illegal transition, and a reserved id that always errors) and one simulation.

Everything the real runs create is named with a `cmp-` prefix and removed afterwards. None of the runs touch the production Supabase project or the deployed gateway.

## Notes

- Input tokens are uncached plus cache-write plus cache-read tokens. Almost all are cache reads, because every turn re-reads the whole conversation. Output includes thinking tokens. Cost is the `total_cost_usd` the CLI reported.
- A turn is one model round trip, close to the number of tool calls.
- **Not counted for the simulation:** building the mocks and simulations. The same four services built from scratch cost $15.35, against $7.52 with them ready, so building cost about $7.8 in total. It pays off with reuse.
- **Counted for the real arm:** bringing up Postgres, PostgREST and the real services from source.
- One run per cell, so run-to-run noise was not measured; repeat runs during setup differed by roughly 20-25%. The context graph gate that the repo normally applies to edits was off in every run.

