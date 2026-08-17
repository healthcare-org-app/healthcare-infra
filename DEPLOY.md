# Deploying healthcare-org

Two things run in prod:

1. **Frontend + API gateway** — one Vercel project (`myhealthcare`) serving both the React SPA at `myhealthcare.dev` and the gateway functions at `myhealthcare.dev/api/*`. Deployed from `frontend/`.
2. **Backend** — Supabase project (`rrfwfccgeifixabadfem`). Managed Postgres + PostgREST. Nothing to deploy per push; schema is in `supabase-schema.sql`.

There is no service fleet to launch. The 101 microservices under `services/` are historical scaffolding — see `README.md#original-microservices-architecture`.

---

## 1. Vercel project setup (one-time)

Already done for the live site; the section below is the reference for anyone recreating it.

1. `cd frontend && npx vercel link` — associate the working tree with the `myhealthcare` project.
2. **Environment variables** (Project Settings → Environment Variables, apply to Preview + Production):

   | Key | Purpose | Where to get it |
   |---|---|---|
   | `VITE_SUPABASE_URL` | SPA build-time constant | Supabase Project Settings → API |
   | `VITE_SUPABASE_ANON_KEY` | SPA build-time constant | Supabase Project Settings → API (anon public JWT) |
   | `SUPABASE_URL` | Gateway runtime | Same value as `VITE_SUPABASE_URL` (no `VITE_` prefix so it stays server-side) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Gateway runtime — bypasses RLS | Supabase Project Settings → API (service role secret). **Never expose client-side.** |
   | `GATEWAY_API_KEY` | Gateway runtime — bearer token external callers present | Generate with `openssl rand -hex 32`. Rotate by regenerating and updating this var + all callers. |

3. Attach the domain `myhealthcare.dev` under Project Settings → Domains (already done).

## 2. Deploy

From the repo root:

```bash
cd frontend
npx vercel deploy            # preview deployment — smoke-test at the preview URL
npx vercel deploy --prod     # promote to myhealthcare.dev
```

Every push to the linked GitHub branch also triggers a deploy automatically. `vercel.json` already excludes `/api/` from the SPA rewrite, so both the SPA and the gateway functions serve from the same domain.

## 3. Verify

### SPA
```bash
open https://myhealthcare.dev
```

### Gateway
```bash
export API=$GATEWAY_API_KEY

# Health + registry discovery
curl -s -H "Authorization: Bearer $API" https://myhealthcare.dev/api/health
curl -s -H "Authorization: Bearer $API" https://myhealthcare.dev/api/services | jq '.count'   # 94

# CRUD smoke
curl -s -H "Authorization: Bearer $API" "https://myhealthcare.dev/api/patients?limit=3"
curl -s -H "Authorization: Bearer $API" "https://myhealthcare.dev/api/patients/search?q=reyes"

# Auth check — must 401
curl -si https://myhealthcare.dev/api/patients | head -1
```

### Postman
Import `postman/collections/gateway.postman_collection.json` and `postman/environments/gateway-prod.postman_environment.json`, set `apiKey` in the environment, then run any request or the collection runner.

## 4. Rollback

```bash
cd frontend
npx vercel ls --prod                             # list production deployments
npx vercel rollback <previous-deployment-url>    # promote a prior one
```

Or in the Vercel dashboard: Deployments → pick one → **Promote to Production**.

---

## Rotating `GATEWAY_API_KEY`

1. Generate a new key: `openssl rand -hex 32`.
2. Update the env var in Vercel (Preview + Production).
3. Redeploy: `vercel deploy --prod`.
4. Update every caller (Postman environment, external integrations) with the new key.

Because the key is a single shared secret, rotation is a coordinated cutover — schedule accordingly if you have external consumers.
