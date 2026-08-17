# Deploying healthcare-org

Two things run in prod:

1. **Frontend + API gateway** — one Vercel project (`myhealthcare`) serving both the React SPA at `myhealthcare.dev` and the gateway functions at `myhealthcare.dev/api/*`. Built from `frontend/` on every push to `healthcare-org-app/healthcare-infra`.
2. **Backend** — Supabase project (`rrfwfccgeifixabadfem`). Managed Postgres + PostgREST. Nothing to deploy per push; schema is in `supabase-schema.sql`.

There is no service fleet to launch. The 101 microservices under `services/` are historical scaffolding — see `README.md#original-microservices-architecture`.

---

## 1. Deploy pipeline (already wired)

The `myhealthcare` Vercel project is linked to `healthcare-org-app/healthcare-infra` with **Root Directory = `frontend`**. This means:

- **Push to `main`** → automatic **production** deploy, aliased to `myhealthcare.dev`.
- **Push to a feature branch** → automatic **preview** deploy at `myhealthcare-git-<branch>-taliakohan-3558s-projects.vercel.app` (behind Vercel Deployment Protection).
- **Open a PR** → Vercel's GitHub app posts the preview URL as a PR comment.

You almost never need the CLI. It's still available as a fallback:

```bash
cd frontend
npx vercel deploy            # preview deployment — smoke-test at the preview URL
npx vercel deploy --prod     # promote to myhealthcare.dev
```

Use it when you need to deploy without a git push (e.g. from a branch you don't want to publish, or to validate a local change before committing).

## 2. Vercel project setup (one-time — reference only)

Already done. Recorded here so this repo can be recreated from scratch.

1. Create the project and link it to the repo:
   - Dashboard → **New Project** → import `healthcare-org-app/healthcare-infra` → set **Root Directory** to `frontend` → **Framework: Vite**.
   - Or from `frontend/`: `npx vercel link` then `npx vercel git connect https://github.com/healthcare-org-app/healthcare-infra.git`.
2. **Environment variables** (Project Settings → Environment Variables, apply to Preview + Production):

   | Key | Purpose | Where to get it |
   |---|---|---|
   | `VITE_SUPABASE_URL` | SPA build-time constant | Supabase Project Settings → API |
   | `VITE_SUPABASE_ANON_KEY` | SPA build-time constant | Supabase Project Settings → API (anon public JWT) |
   | `SUPABASE_URL` | Gateway runtime | Same value as `VITE_SUPABASE_URL` (no `VITE_` prefix so it stays server-side) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Gateway runtime — bypasses RLS | Supabase Project Settings → API (service role secret). **Never expose client-side.** |
   | `GATEWAY_API_KEY` | Gateway runtime — bearer token external callers present | Generate with `openssl rand -hex 32`. Rotate by regenerating and updating this var + all callers. |

3. Attach the domain `myhealthcare.dev` under Project Settings → Domains.

## 3. Verify a deploy

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

Vercel keeps every past deployment addressable. Two ways to roll back:

**Dashboard:** Deployments → pick a known-good `dpl_*` → **Promote to Production**.

**CLI:**
```bash
cd frontend
npx vercel ls --prod                             # list production deployments
npx vercel rollback <previous-deployment-url>    # promote a prior one
```

Rolling back the Vercel deploy does **not** revert the git commit. If the bad code is on `main`, also `git revert <sha> && git push` — otherwise the next push will re-deploy the broken state.

---

## Rotating `GATEWAY_API_KEY`

1. Generate a new key: `openssl rand -hex 32`.
2. Update the env var in Vercel (Preview + Production).
3. Trigger a new deploy — an empty commit works: `git commit --allow-empty -m "chore: rotate gateway key" && git push`. (Env-var changes only take effect on the next build.)
4. Update every caller (Postman environment, external integrations) with the new key.

Because the key is a single shared secret, rotation is a coordinated cutover — schedule accordingly if you have external consumers.
