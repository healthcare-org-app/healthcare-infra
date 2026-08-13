# healthcare-org

A production-shaped healthcare admin platform. **Live at https://myhealthcare.dev.**

The frontend is a React SPA on **Vercel**. The backend is a **Supabase** project — Postgres + PostgREST + row-level-security policies. There is no server-side code to deploy: PostgREST auto-generates a REST API from the Postgres schema, and the SPA talks to it directly.

This repo (`healthcare-infra`) is the meta repo: it holds the SQL migrations, the deployment blueprint archive, and this documentation. The service catalog, event topology, and the 101 microservice scaffolds still exist as **historical artifacts** — see [Original microservices architecture](#original-microservices-architecture) at the bottom.

---

## Table of contents

- [At a glance](#at-a-glance)
- [Architecture](#architecture)
- [Frontend (Vercel)](#frontend-vercel)
- [Backend (Supabase)](#backend-supabase)
- [How the frontend talks to the backend](#how-the-frontend-talks-to-the-backend)
- [Domain + DNS](#domain--dns)
- [Local development](#local-development)
- [Making changes](#making-changes)
- [Original microservices architecture](#original-microservices-architecture)

---

## At a glance

| Piece | Where | What |
|---|---|---|
| **Frontend** | Vercel | React 18 + Vite + TS + Tailwind SPA at [myhealthcare.dev](https://myhealthcare.dev) |
| **Database** | Supabase | Managed Postgres 16, 94 tables auto-exposed as REST |
| **API** | Supabase (PostgREST) | Auto-generated REST from the schema — no hand-written endpoints |
| **Auth** | none (demo) | Permissive RLS policies let the anon key CRUD everything |
| **Events** | Postgres LISTEN/NOTIFY (unused in the SPA) | Wired into the runtime library but not exercised by the current SPA |
| **Domain** | Vercel Domains | `myhealthcare.dev` — registered through Vercel, Vercel DNS |
| **Cost** | ~$0/mo | Vercel Hobby free, Supabase Free tier |

## Architecture

```
                            ┌──────────────────────┐
     browsers ──────────▶   │  Vercel (SPA)        │  myhealthcare.dev
                            │  React + Vite + TS   │
                            └──────────┬───────────┘
                                       │  HTTPS /rest/v1/<table>
                                       │  headers: apikey + Authorization
                                       ▼
                            ┌──────────────────────┐
                            │  Supabase project    │  rrfwfccgeifixabadfem.supabase.co
                            │  ┌────────────────┐  │
                            │  │  PostgREST     │  │   auto-generated REST API
                            │  └────────┬───────┘  │
                            │           │          │
                            │  ┌────────▼───────┐  │
                            │  │  Postgres 16   │  │   94 tables, RLS enabled
                            │  └────────────────┘  │
                            └──────────────────────┘
```

There is no application server, no Kafka, no per-service Docker containers, no Consul. Every "service" from the original design is now a Postgres table.

## Frontend (Vercel)

- **Repo layout** (this monorepo, `frontend/`):
  ```
  frontend/
  ├── src/
  │   ├── App.tsx              # router shell
  │   ├── main.tsx             # entrypoint
  │   ├── api.ts               # thin supabase-js wrapper preserving the old CRUD interface
  │   ├── supabase.ts          # createClient using env vars
  │   ├── services.ts          # registry of all 101 services + FK map + label formatters
  │   ├── domain-icons.ts      # lucide icons per domain
  │   ├── components/          # Sidebar, TopBar, ResourceTable, ResourceForm, KpiTile, Logo, ResourceDetail
  │   └── pages/               # Dashboard, DomainLanding, ServicePage, RecordDetail, PatientDetail
  ├── index.html
  ├── vite.config.ts
  ├── tailwind.config.js
  ├── vercel.json              # SPA rewrites + asset caching
  └── .env.example             # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  ```

- **Vercel project**: `taliakohan-3558s-projects/myhealthcare`. Deploys from the linked GitHub repo (`healthcare-org-app/healthcare-infra`) or via `vercel --prod` from `frontend/`.

- **Env vars set on Vercel** (Project Settings → Environment Variables):
  | Key | Purpose |
  |---|---|
  | `VITE_SUPABASE_URL` | `https://rrfwfccgeifixabadfem.supabase.co` |
  | `VITE_SUPABASE_ANON_KEY` | Public anon JWT (safe to embed in the client) |

- **Routing**: React Router with client-side routes. `vercel.json` rewrites all non-`/api/` paths to `/index.html` so deep links work.

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
- **Seed data** (see `infra/supabase-fix.sql`): 6 patients, 4 providers, 6 encounters, 5 appointments, 4 prescriptions, 4 lab orders, 3 lab results, 4 invoices — so the frontend has something to render on first load.

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

## Domain + DNS

`myhealthcare.dev` is registered **through Vercel Domains**, with Vercel's nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). No external DNS provider. The domain is attached to the `myhealthcare` Vercel project, which serves it directly.

Renewal: **$13/yr** (Vercel pass-through).

## Local development

```bash
cd frontend
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (values from Supabase → Project Settings → API)
npm install
npm run dev            # http://127.0.0.1:5173
```

The dev server hits the same Supabase project the deployed app uses. That means:
- Reads and writes in dev show up in prod.
- Deleting a row in dev deletes it for the live site.
- If that's a problem, create a second Supabase project for a "dev" env and put its URL/key in `.env`.

`npm run build` compiles the SPA into `frontend/dist/`; Vercel does this on every push to the linked repo, or on `vercel --prod`.

## Making changes

**Change a form field on an existing service.** Edit `frontend/src/services.ts` — find the service's `createFields` array and add/reorder. Refresh; Vite HMR picks it up. Deploy with `vercel --prod`.

**Add a new service.**
1. Add an entry to `SERVICES` in `frontend/src/services.ts` with a `createFields` array.
2. Add its table to `infra/supabase-schema.sql` (or run one-off DDL in the Supabase SQL Editor):
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
python3 tools/generate_supabase_schema.py    # writes infra/supabase-schema.sql
```

Then paste the new tables' DDL into the Supabase SQL Editor.

---

## Original microservices architecture

The 101-service microservices design still exists as scaffolding under `services/` and across 104 repos in the `healthcare-org-app` GitHub org. It was **not deployed** — instead the SPA was pointed at Supabase which auto-exposes the same shapes as REST endpoints. Reasons:

- **Render's 25-resource cap** made a fleet-of-94 deploy impractical without a workspace-tier upgrade.
- **~$700/mo** for a demo when Supabase runs the same shape for **$0**.
- **PostgREST + Postgres** delivers exactly what the frontend needs (typed CRUD, JSONB filters, pagination, count headers, upsert semantics) with none of the operational overhead.

The scaffolding is left intact because the code is still useful reading — the `libs/py-healthcare-common` shared runtime (Flask + LISTEN/NOTIFY event bus + connection pool + audit publisher + JWT middleware + CORS), the per-service scaffold generator (`tools/scaffold.py`), and the docker-compose bring-up (`infra/run.sh`) all still work locally. If you ever want to run the fleet again:

```bash
cd infra
./run.sh core             # 7 baseline services
./run.sh clinical billing # add more stacks
```

See the earlier revision of this README in git history for the full microservices detail — service catalog, event topology, cross-service call graph, ERP integration.

The Render Blueprint at `infra/render.yaml` (94 services + Postgres + env group) is also still there. It'd deploy the fleet to Render if launched, at the ~$700/mo cost noted above.
