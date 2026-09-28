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
   | `NYLAS_API_KEY` | Gateway runtime — reads clinician inbox/calendar, sends invites. Doubles as the OAuth client secret. | Nylas Dashboard → your application → API Keys. **Never expose client-side.** |
   | `NYLAS_CLIENT_ID` | Gateway runtime — identifies the app in the hosted OAuth flow | Nylas Dashboard → your application → Overview. |
   | `NYLAS_CALLBACK_URI` | Gateway runtime — where Nylas returns the auth code | `https://myhealthcare.dev/api/nylas/callback`. Must be registered verbatim under Dashboard → Hosted Authentication → Callback URIs, including for each preview domain you test from. |
   | `NYLAS_API_URI` | Optional — Nylas data-plane host (default `https://api.us.nylas.com`) | Set to `https://api.eu.nylas.com` only if the Nylas application is provisioned in the EU. A mismatch returns 401, not a redirect. |
   | `NYLAS_CONNECT_RETURN_URL` | Optional — SPA page a clinician lands on after connecting | e.g. `https://myhealthcare.dev/settings/integrations`. Unset, the callback returns JSON (useful locally). |
   | `CLINIC_TIMEZONE` | Optional — timezone stamped on created calendar events and reminder text (default `America/New_York`) | IANA zone name for the practice. |
   | `NOTION_API_KEY` | Gateway runtime — creates and updates Notion pages | Notion → Settings → Connections → your internal integration → Configuration → Internal Integration Secret (`ntn_…`). **Never expose client-side.** |
   | `NOTION_DATABASE_ID` | Optional — database `/api/notion/pages` writes to when a request omits `database_id` | The 32-hex segment of the database URL: `notion.so/<workspace>/<DATABASE_ID>?v=…`. |
   | `NOTION_VERSION` | Optional — Notion API version header (default `2022-06-28`) | Leave unset. `2025-09-03` and later replace `parent.database_id` with data sources, which `_lib/notion.ts` does not implement. |
   | `PAYPAL_CLIENT_ID` | Gateway runtime — emails patient invoices via PayPal Invoicing | PayPal Developer Dashboard → Apps & Credentials → your app → Client ID. Must come from the same environment (sandbox or live) as `PAYPAL_API_BASE`. |
   | `PAYPAL_CLIENT_SECRET` | Gateway runtime — exchanged with the client ID for an OAuth2 access token | Same app → Secret. **Never expose client-side.** |
   | `PAYPAL_API_BASE` | Optional — PayPal host (default `https://api-m.sandbox.paypal.com`) | Set to `https://api-m.paypal.com` for live. Sandbox credentials against the live host return 401. |
   | `PAYPAL_MERCHANT_GIVEN_NAME`, `PAYPAL_MERCHANT_SURNAME` | Gateway runtime — the invoicer name PayPal prints on every invoice | The practice's billing contact. PayPal rejects an invoicer whose account is not in good standing. |
   | `PAYPAL_MERCHANT_EMAIL`, `PAYPAL_MERCHANT_ADDRESS_LINE_1`, `PAYPAL_MERCHANT_CITY`, `PAYPAL_MERCHANT_STATE`, `PAYPAL_MERCHANT_POSTAL_CODE` | Optional — remitting address shown on the invoice | The practice's billing address. |
   | `PAYPAL_MERCHANT_COUNTRY_CODE` | Optional — invoicer country (default `US`) | Two-letter ISO code. |
   | `PAYPAL_CURRENCY_CODE` | Optional — invoice currency (default `USD`) | Three-letter ISO code. Overridable per request. |
   | `DOCUSIGN_INTEGRATION_KEY` | Gateway runtime — sends consent forms for e-signature. The JWT `iss`. | DocuSign Apps and Keys → your app → Integration Key (a GUID). |
   | `DOCUSIGN_USER_ID` | Gateway runtime — the user the gateway impersonates; the JWT `sub` | Apps and Keys → **User ID** of the service account (a GUID, *not* the email address). |
   | `DOCUSIGN_PRIVATE_KEY` | Gateway runtime — RSA key that signs the JWT assertion | Apps and Keys → your app → Generate RSA keypair; paste the **private** key. Vercel vars cannot hold literal newlines, so store it with `\n` escapes — `_lib/docusign.ts` unescapes both forms. **Never expose client-side.** |
   | `DOCUSIGN_OAUTH_BASE` | Optional — account host that issues tokens (default `https://account-d.docusign.com`, demo) | Set to `https://account.docusign.com` for production. This is a *different axis* from the API host below. |
   | `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_API_BASE` | Optional — pin the account and its API host, skipping the `/oauth/userinfo` round trip | Leave both unset and the gateway discovers them. If you set them, set them together and take `DOCUSIGN_API_BASE` from userinfo's `base_uri` plus `/restapi` (e.g. `https://na4.docusign.net/restapi`) — a production account reached at `demo.docusign.net` returns 401 on a perfectly valid token. |
   | `DOCUSIGN_CONSENT_TEMPLATE_ID` | Optional — default template `POST /api/patient_consent/:id/send-for-signature` uses when the request and row name none | DocuSign → Templates → your consent form → Template ID. Without it, every send must carry `template_id` or `document_base64`. |

   DocuSign JWT Grant additionally needs **one-time impersonation consent**: until the `DOCUSIGN_USER_ID` account has granted it, every token exchange fails with `consent_required`. The gateway returns that error with the exact consent URL to visit — open it while signed in as that user. Consent is per integration key *and* per environment, so demo and production each need their own.

   The Notion integration must also be **shared with each database or page it touches** (page → ⋯ → Connections → add the integration). Without that, Notion answers `404 object_not_found` for a page that plainly exists — it is a permission error wearing a 404.

   **PHI:** Notion is not HIPAA-eligible and Notion will not sign a BAA, so patient-identifying data must not be sent to it. The gateway's Notion endpoints deliberately read nothing from Supabase — the caller chooses every value that leaves the system.

   **PHI:** PayPal will not sign a BAA either, and unlike the Notion endpoints, `POST /api/invoicing/:id/send` *does* read from Supabase — the patient's name and email reach PayPal by necessity, since they are who the invoice is addressed to. The clinical `description` on the invoicing row does not: the line item reads "Medical services" unless the caller passes `include_description: true`. Treat that flag as a disclosure decision, not a formatting one.

   **PHI:** DocuSign is the one third party here that *will* sign a BAA — but not by default. HIPAA support is a paid account configuration, and a standard or demo account is not covered no matter what you send it. Confirm the BAA is executed and the account is provisioned for HIPAA before pointing `DOCUSIGN_OAUTH_BASE` at production, because `POST /api/patient_consent/:id/send-for-signature` sends the patient's name and email by necessity and the consent document itself is clinical by definition. `GET /api/patient_consent/:id/signed-document` returns that executed document as a PDF and is marked `Cache-Control: no-store` for the same reason.

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

# Nylas — connect a clinician's mailbox. Returns an auth_url; open it in a
# browser, approve, and Nylas redirects to /api/nylas/callback to store the grant.
curl -s -X POST -H "Authorization: Bearer $API" -H 'Content-Type: application/json' \
  -d '{"provider_id":1,"provider":"google"}' \
  https://myhealthcare.dev/api/nylas/connect | jq -r '.auth_url'

# Then, once connected:
curl -s -H "Authorization: Bearer $API" \
  "https://myhealthcare.dev/api/nylas/inbox?provider_id=1&limit=5&unread=true" | jq '.count'
curl -s -H "Authorization: Bearer $API" \
  "https://myhealthcare.dev/api/nylas/calendar?provider_id=1" | jq '.calendars[].id'
curl -s -X POST -H "Authorization: Bearer $API" -H 'Content-Type: application/json' \
  -d '{"provider_id":1,"start":"2026-09-01T13:00:00Z","end":"2026-09-01T21:00:00Z","duration_minutes":30}' \
  https://myhealthcare.dev/api/nylas/availability | jq '.slots[0]'

# Book appointment 1 onto the clinician's calendar and email the patient an
# invite. Idempotent — a repeat call reads the existing event back.
curl -s -X POST -H "Authorization: Bearer $API" \
  https://myhealthcare.dev/api/appointments/1/invite | jq '{event_created, nylas_event_id, nylas_event_link}'

# Notion — create a page in a database. Property values are plain JSON and are
# coerced against the database's own schema, so a select is just its name and a
# date is just an ISO string. Omit "database_id" to use NOTION_DATABASE_ID.
PAGE=$(curl -s -X POST -H "Authorization: Bearer $API" -H 'Content-Type: application/json' \
  -d '{"properties":{"Name":"Gateway deploy check","Status":"Open","Due":"2026-09-30"}}' \
  https://myhealthcare.dev/api/notion/pages | jq -r '.id')

# Read it back — `property_types` tells you how to shape the update.
curl -s -H "Authorization: Bearer $API" \
  "https://myhealthcare.dev/api/notion/pages/$PAGE" | jq '{id, url, properties, property_types}'

# Update only the named properties; everything else on the page is untouched.
curl -s -X PATCH -H "Authorization: Bearer $API" -H 'Content-Type: application/json' \
  -d '{"properties":{"Status":"Done"}}' \
  "https://myhealthcare.dev/api/notion/pages/$PAGE" | jq '.properties'

# Notion has no page delete. Archiving is the delete, and it reverses.
curl -s -X PATCH -H "Authorization: Bearer $API" -H 'Content-Type: application/json' \
  -d '{"archived":true}' "https://myhealthcare.dev/api/notion/pages/$PAGE" | jq '.archived'

# PayPal — bill invoicing row 1 to the patient on it. Creates a draft invoice,
# sends it, and returns the payer-view link the patient pays through.
# Idempotent: a repeat call reads the existing PayPal invoice back rather than
# billing twice, and a row already marked paid/void 409s.
curl -s -X POST -H "Authorization: Bearer $API" \
  https://myhealthcare.dev/api/invoicing/1/send \
  | jq '{invoice_sent, paypal_invoice_id, paypal_payer_view_url}'
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
