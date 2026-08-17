# healthcare-org

A production-shaped healthcare admin platform. **Live at https://myhealthcare.dev.**

Three moving pieces:
- **React SPA on Vercel** — the UI. Talks to Supabase directly via supabase-js.
- **Supabase project** — managed Postgres 16 + PostgREST + RLS. 94 tables.
- **Public API gateway** — 10 Vercel Functions in the same Vercel project. Serves `/api/*` for external callers (agents, Postman, integrations). Backed by the same Supabase DB via the service-role key.

This repo (`healthcare-infra`) is the meta repo: it holds the SQL migrations, the gateway source, the Postman collection, and this documentation. The 101 microservice scaffolds under `services/` still exist as **historical artifacts** — see [Original microservices architecture](#original-microservices-architecture) at the bottom.

---

## Table of contents

- [At a glance](#at-a-glance)
- [Architecture](#architecture)
- [Frontend (Vercel)](#frontend-vercel)
- [Backend (Supabase)](#backend-supabase)
- [How the frontend talks to the backend](#how-the-frontend-talks-to-the-backend)
- [Public API gateway](#public-api-gateway)
- [Domain + DNS](#domain--dns)
- [Local development](#local-development)
- [Making changes](#making-changes)
- [Original microservices architecture](#original-microservices-architecture)

---

## At a glance

| Piece | Where | What |
|---|---|---|
| **Frontend** | Vercel | React 18 + Vite + TS + Tailwind SPA at [myhealthcare.dev](https://myhealthcare.dev) |
| **Public API** | Vercel Functions | 10 handlers under `frontend/api/`. Serves `/api/*` for external callers |
| **Database** | Supabase | Managed Postgres 16, 94 tables auto-exposed as REST |
| **SPA → DB** | Supabase PostgREST | SPA hits Supabase directly with anon key + user JWT (RLS enforced) |
| **External → DB** | Gateway → Supabase | External callers hit gateway with bearer key; gateway uses service-role key (RLS bypassed) |
| **Auth (SPA)** | Supabase Auth magic-link | Permissive RLS lets logged-in users CRUD everything |
| **Auth (gateway)** | Bearer API key | Single shared `GATEWAY_API_KEY` env var; rotate to invalidate |
| **Events** | Postgres LISTEN/NOTIFY (unused) | Wired into the historical scaffolds; not exercised today |
| **Domain** | Vercel Domains | `myhealthcare.dev` — registered through Vercel, Vercel DNS |
| **Cost** | ~$0/mo | Vercel Hobby free (10/12 functions used), Supabase Free tier |

## Architecture

```
                                     myhealthcare.dev
                        ┌──────────────────────────────────────────┐
                        │            Vercel project                │
                        │                                          │
                        │   ┌──────────────┐   ┌───────────────┐   │
        browsers  ─────▶│   │  SPA (Vite)  │   │   /api/*      │◀──┼─── external callers
                        │   │  React + TS  │   │  functions    │   │    (agents, Postman,
                        │   │              │   │  frontend/api/│   │     integrations)
                        │   └──────┬───────┘   └───────┬───────┘   │
                        │          │                   │           │
                        └──────────┼───────────────────┼───────────┘
                                   │                   │
                            /rest/v1/<table>    service-role key
                            anon key + user JWT        │
                                   │                   │
                                   ▼                   ▼
                        ┌──────────────────────────────────────────┐
                        │        Supabase project                  │
                        │        rrfwfccgeifixabadfem              │
                        │  ┌────────────┐  ┌─────────────────────┐ │
                        │  │ PostgREST  │  │  Postgres 16        │ │
                        │  │ /rest/v1/* │──│  94 tables, RLS on  │ │
                        │  └────────────┘  └─────────────────────┘ │
                        └──────────────────────────────────────────┘
```

Two paths into the same tables:
- **SPA path** (`browsers → SPA → Supabase`): anon key + user JWT; RLS enforced.
- **Gateway path** (`external caller → /api/* → Supabase`): bearer key at the edge; service-role key at the DB; RLS bypassed.

No Kafka, no per-service containers, no Consul — the original 101-service fleet was never deployed.

## Frontend (Vercel)

- **Repo layout** (this monorepo, `frontend/`):
  ```
  frontend/
  ├── src/                     # the SPA
  │   ├── App.tsx              #   router shell
  │   ├── main.tsx             #   entrypoint
  │   ├── api.ts               #   thin supabase-js wrapper preserving the CRUD interface
  │   ├── supabase.ts          #   createClient using VITE_* env vars
  │   ├── services.ts          #   registry of all 101 services + FK map + label formatters
  │   ├── domain-icons.ts      #   lucide icons per domain
  │   ├── components/          #   Sidebar, TopBar, ResourceTable, ResourceForm, KpiTile, ...
  │   └── pages/               #   Dashboard, DomainLanding, ServicePage, RecordDetail, ...
  ├── api/                     # the gateway (Vercel Functions — see Public API gateway below)
  │   ├── _lib/                #   private helpers (underscore hides from Vercel routing)
  │   ├── health.ts            #   GET /api/health
  │   ├── services.ts          #   GET /api/services  (registry discovery)
  │   ├── [resource]/          #   dynamic CRUD for all 94 exposed resources
  │   │   ├── index.ts         #     list + create
  │   │   └── [id].ts          #     get + patch + delete
  │   ├── patients/search.ts   #   custom action
  │   ├── appointments/[id]/{cancel,check-in}.ts
  │   ├── prescriptions/[id]/refill.ts
  │   ├── eligibility/[id]/check.ts
  │   └── notifications/send.ts
  ├── index.html
  ├── vite.config.ts
  ├── tailwind.config.js
  ├── vercel.json              # SPA rewrites + asset caching; /api/* excluded from SPA rewrite
  └── .env.example             # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  ```

- **Vercel project**: `taliakohan-3558s-projects/myhealthcare`. Deploys from the linked GitHub repo (`healthcare-org-app/healthcare-infra`) or via `vercel --prod` from `frontend/`.

- **Env vars set on Vercel** (Project Settings → Environment Variables — apply to Preview + Production):
  | Key | Used by | Purpose |
  |---|---|---|
  | `VITE_SUPABASE_URL` | SPA build | `https://rrfwfccgeifixabadfem.supabase.co` — embedded in the client bundle |
  | `VITE_SUPABASE_ANON_KEY` | SPA build | Public anon JWT — safe to embed |
  | `SUPABASE_URL` | Gateway runtime | Same URL, no `VITE_` prefix so it stays server-side |
  | `SUPABASE_SERVICE_ROLE_KEY` | Gateway runtime | Service-role secret; bypasses RLS. **Never expose client-side.** |
  | `GATEWAY_API_KEY` | Gateway runtime | Bearer token external callers present. Generate with `openssl rand -hex 32` |

- **Routing**: React Router with client-side routes. `vercel.json` rewrites all non-`/api/` paths to `/index.html` so deep links work; `/api/*` bypasses the rewrite and hits the Vercel Functions in `api/`.

- **Service registry** (`frontend/src/services.ts`) is the source of truth for what the UI shows:
  - 101 service definitions, each with `name`, `port` (historical), `domain`, `stack`, `resource` (table name), `prefix` (`/api/<resource>`), `displayName`, `hasCrud`, plus **`createFields`** — a healthcare-shaped form schema per service (patient/provider dropdowns, date pickers, priority selects, ICD-10 fields, etc.).
  - `FK_TARGETS` maps 20 foreign-key field names (`patient_id`, `provider_id`, `encounter_id`, …) to their target service. Forms and tables use this to swap raw IDs for real dropdowns and clickable labels.
  - `formatRefLabel()` formats a row as a human string per service — e.g. patients → `"Ava Reyes (MRN-001)"`, providers → `"Sarah Chen — Family Medicine"`.
  - `ENABLED_STACKS` — legacy from the microservices deploy. Under Supabase every service is in one database, so effectively all stacks are on.

- **Generic components**:
  - `ResourceTable` — reads a service's rows, auto-picks the top 5 non-JSONB columns, resolves FK columns to labels (fetches the target service's rows once, caches for the page).
  - `ResourceForm` — renders inputs from `createFields`. For any key in `FK_TARGETS`, renders a `<select>` populated live from the target service.
  - `ResourceDetail`, `KpiTile`, `PatientDetail`, `Sidebar`, `TopBar` — cross-service views and layout.

## Backend (Supabase)

- **Project**: `rrfwfccgeifixabadfem` (URL: `https://rrfwfccgeifixabadfem.supabase.co`).
- **Postgres 16** managed, single database, `public` schema. No separate schemas — one flat table per service.
- **94 tables** (one per Python service in the original design; Go/Node stubs and BFF-style services are excluded). Each table follows the same shape:
  ```sql
  create table public.<resource> (
    id           bigserial primary key,
    data         jsonb not null default '{}'::jsonb,   -- payload fields go here
    status       text not null default 'active',
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
  );
  create index on public.<resource> using gin (data);
  create index on public.<resource> (status);
  create trigger <resource>_set_updated_at before update ...  -- auto-bumps updated_at
  ```
- **`patients` extras**: additional top-level columns `first_name`, `last_name`, `dob`, `mrn` (unique), `identity_sub` — matching the golden hand-written service.
- **RLS**: enabled on every table with a single permissive policy:
  ```sql
  create policy anon_all on public.<resource>
    for all to anon using (true) with check (true);
  ```
  This is a **demo-mode config** — the anon key can do everything. Replacing `using (true)` with real predicates (e.g. `auth.uid() = user_id`) is how you'd move toward production.
- **Grants**: `anon` has `SELECT, INSERT, UPDATE, DELETE` on all tables and `USAGE, SELECT` on all sequences. `alter default privileges` extends this to future tables.
- **PostgREST** (built into Supabase) auto-exposes every table at `/rest/v1/<table>` with standard operators:
  - `?id=eq.5` — exact match
  - `?data->>patient_id=eq.5` — JSONB field match
  - `?limit=50&offset=0` — pagination
  - `Prefer: return=representation` header — returns the inserted/updated row
- **Seed data** (see `supabase-fix.sql`): 6 patients, 4 providers, 6 encounters, 5 appointments, 4 prescriptions, 4 lab orders, 3 lab results, 4 invoices — so the frontend has something to render on first load.

## How the frontend talks to the backend

Every `/api/<resource>/...` call the pages make goes through `frontend/src/api.ts`, which is now a thin adapter over `@supabase/supabase-js`:

```typescript
// api.ts (excerpt)
async list(prefix, params) {
  const table = prefix.replace(/^\/api\//, "").replace(/-/g, "_");
  let q = supabase.from(table).select("*", { count: "exact" });
  for (const [k, v] of Object.entries(params)) {
    if (BASE_TYPED_COLS.has(k) || (table === "patients" && PATIENTS_TYPED_COLS.has(k))) {
      q = q.eq(k, v);
    } else {
      q = q.eq(`data->>${k}`, v);   // JSONB field
    }
  }
  const { data, count, error } = await q;
  return { count: count ?? data.length, items: unwrapAll(data) };
}
```

Two important shims live here:
- **`unwrap()`** — Supabase returns `{id, data: {...}, status, created_at, updated_at}`. The frontend components expect the JSONB fields spread at the top level (`{id, patient_id, drug, ..., status, created_at, updated_at}`). `unwrap` flattens `data` back onto the row.
- **`splitBody()`** — the inverse for writes. Given a form body like `{patient_id: 5, drug: "Lisinopril"}`, decides which keys are typed columns (only for `patients`) and which go into the `data` JSONB.

Auth headers (`apikey: <anon>` and `Authorization: Bearer <anon>`) are added automatically by the supabase-js client using `VITE_SUPABASE_ANON_KEY`.

## Public API gateway

External callers (agents, Postman collections, third-party integrations) hit the app through a thin **Vercel Functions gateway** deployed alongside the SPA in the same Vercel project. Base URL: `https://myhealthcare.dev/api/...`.

```
    external clients ──▶  myhealthcare.dev/api/*  ──▶  Vercel Functions  ──▶  Supabase PostgREST
                          (bearer API key)              (frontend/api/)         (service role key)
```

- **Auth**: `Authorization: Bearer $GATEWAY_API_KEY` on every request. The gateway holds the Supabase **service-role** key server-side and bypasses RLS — the gateway is the trust boundary, not RLS. Missing or invalid key → 401.
- **URL shape**: matches the `prefix` declared for each service in `frontend/src/services.ts`.
  - `GET /api/<resource>` — list (filters as query params, `?limit=`, `?offset=`).
  - `POST /api/<resource>` — create.
  - `GET|PATCH|DELETE /api/<resource>/<id>` — record CRUD.
- **Custom actions** (the six declared in `services.ts`):
  - `GET  /api/patients/search?q=<term>` — ilike over `first_name`, `last_name`, `mrn`.
  - `POST /api/appointments/<id>/cancel` — sets `status='cancelled'`.
  - `POST /api/appointments/<id>/check-in` — sets `status='checked-in'`.
  - `POST /api/prescriptions/<id>/refill` — inserts a `refills` row.
  - `GET  /api/eligibility/<id>/check` — re-reads row + returns `checked_at`.
  - `POST /api/notifications/send` — inserts a queued notification row.
- **Discovery**: `GET /api/health` and `GET /api/services` (returns the 94-resource registry so callers can enumerate what's exposed).
- **Which resources are exposed**: the 94 services in `services.ts` with `hasCrud:true`. The 7 with `hasCrud:false` (api-gateway, service-registry, patient-portal-api, provider-portal-api, device-telemetry-service, sms-gateway-service, secure-messaging-service) return 404.
- **Field storage**: same convention as the SPA — base typed columns are `id, status, created_at, updated_at`; `patients` also has `first_name, last_name, dob, mrn, identity_sub`; everything else is merged into a `data` JSONB column on write and flattened on read.
- **Postman collection**: `postman/collections/gateway.postman_collection.json` (478 requests, one folder per domain) with a matching environment at `postman/environments/gateway-prod.postman_environment.json`.
- **Note on the SPA**: the SPA still talks to Supabase directly via supabase-js; it does **not** route through the gateway. The gateway is for external callers only.
- **Note on Vercel function count**: this gateway uses 10 serverless functions, which fits within the Vercel Hobby limit of 12.

Source lives under `frontend/api/`. See `DEPLOY.md` for env vars and deploy steps.

## Domain + DNS

`myhealthcare.dev` is registered **through Vercel Domains**, with Vercel's nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). No external DNS provider. The domain is attached to the `myhealthcare` Vercel project, which serves it directly.

Renewal: **$13/yr** (Vercel pass-through).

## Local development

### SPA only (fast, no gateway)

```bash
cd frontend
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (values from Supabase → Project Settings → API)
npm install
npm run dev            # http://127.0.0.1:5173
```

`vite dev` doesn't run the gateway functions — the SPA hits Supabase directly, exactly like in prod.

### SPA + gateway together

```bash
cd frontend
# .env.local (not checked in) needs all five vars:
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GATEWAY_API_KEY
npx vercel dev         # http://localhost:3000 — serves both SPA and /api/*
```

`vercel dev` compiles the `api/` handlers as local functions. Smoke-test the gateway:

```bash
export API=$(grep GATEWAY_API_KEY .env.local | cut -d= -f2)
curl -s -H "Authorization: Bearer $API" http://localhost:3000/api/health
curl -s -H "Authorization: Bearer $API" "http://localhost:3000/api/patients?limit=3"
```

### Shared-database caveat

Whether you run `vite dev` or `vercel dev`, you're hitting the same Supabase project the deployed app uses:
- Reads and writes in dev show up in prod.
- Deleting a row in dev deletes it for the live site.
- If that's a problem, create a second Supabase project for a "dev" env and put its URL/keys in `.env.local`.

`npm run build` compiles the SPA into `frontend/dist/`; `tsc -b` runs first and type-checks both `src/` and `api/`. Vercel does the full build on every push to the linked repo, or on `vercel deploy --prod`.

## Making changes

**Change a form field on an existing service.** Edit `frontend/src/services.ts` — find the service's `createFields` array and add/reorder. Refresh; Vite HMR picks it up. Deploy with `vercel --prod`.

**Add a new service.**
1. Add an entry to `SERVICES` in `frontend/src/services.ts` with a `createFields` array.
2. Add its table to `supabase-schema.sql` (or run one-off DDL in the Supabase SQL Editor):
   ```sql
   create table if not exists public.<resource> (
     id           bigserial primary key,
     data         jsonb not null default '{}'::jsonb,
     status       text not null default 'active',
     created_at   timestamptz not null default now(),
     updated_at   timestamptz not null default now()
   );
   ```
3. Grant + policy (or re-run `supabase-fix.sql` which loops over every public table).
4. Redeploy the frontend.

**Add a new foreign-key relationship.** Add the field name to `FK_TARGETS` in `services.ts` mapping to the target service. Nothing else needs changing — the form auto-renders a dropdown and the table auto-resolves labels.

**Regenerate the schema from `registry.yaml`.** If you edit the service catalog:
```bash
python3 tools/generate_supabase_schema.py    # writes supabase-schema.sql
```

Then paste the new tables' DDL into the Supabase SQL Editor.

**Expose a new resource through the gateway.** Add a `{ url, table, domain }` entry to `RESOURCES` in `frontend/api/_lib/registry.ts`. That's it — the dynamic `[resource]/index.ts` and `[resource]/[id].ts` handlers pick it up automatically. Redeploy with `vercel deploy --prod`.

**Add a new gateway custom action.**
1. Create a handler at `frontend/api/<resource>/[id]/<action>.ts` (or `frontend/api/<resource>/<action>.ts` for a bulk action).
2. Copy the shape from an existing action (e.g. `appointments/[id]/cancel.ts`): `withCors(handler)`, `requireApiKey(req)`, resolve id, run the Supabase mutation, `mergeRow` the response.
3. Add a request to `postman/collections/gateway.postman_collection.json` under the **Custom Actions** folder so external callers can discover it.
4. Redeploy. Vercel's file router prefers your static path over the dynamic `[id].ts` catch-all, so no route conflict.

**Rotate the gateway API key.** Regenerate with `openssl rand -hex 32`, update `GATEWAY_API_KEY` in Vercel (Preview + Production), redeploy, then update every caller (Postman env, external integrations). Because it's a single shared secret, rotation is a coordinated cutover.

---

## Original microservices architecture

The 101-service microservices design still exists as scaffolding under `services/` and across 104 repos in the `healthcare-org-app` GitHub org. It was **not deployed** — instead the SPA was pointed at Supabase which auto-exposes the same shapes as REST endpoints. Reasons:

- **Render's 25-resource cap** made a fleet-of-94 deploy impractical without a workspace-tier upgrade.
- **~$700/mo** for a demo when Supabase runs the same shape for **$0**.
- **PostgREST + Postgres** delivers exactly what the frontend needs (typed CRUD, JSONB filters, pagination, count headers, upsert semantics) with none of the operational overhead.

The scaffolding is left intact because the code is still useful reading — the `libs/py-healthcare-common` shared runtime (Flask + LISTEN/NOTIFY event bus + connection pool + audit publisher + JWT middleware + CORS), the per-service scaffold generator (`tools/scaffold.py`), and the docker-compose bring-up (`run.sh`) all still work locally. If you ever want to run the fleet again:

```bash
./run.sh core             # 7 baseline services
./run.sh clinical billing # add more stacks
```

`services/`, `libs/`, and `tools/` live in separate GitHub repos under `healthcare-org-app` and are gitignored here — clone them alongside this repo to run the historical fleet locally.

See the earlier revision of this README in git history for the full microservices detail — service catalog, event topology, cross-service call graph, ERP integration.

The Render Blueprint (`render.yaml`, 94 services + Postgres + env group) was **removed** from the tree. To rebuild it, regenerate from `registry.yaml` and `tools/generate_render_yaml.py`, or recover an older revision from git history. Render would still require a workspace-tier plan to clear the 25-resource cap, at ~$700/mo.
