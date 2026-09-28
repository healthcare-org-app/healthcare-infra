import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { assertFkExists } from "../_lib/businessRules.js";
import { hostedAuthUrl } from "../_lib/nylas.js";
import { signState, STATE_TTL_SECONDS } from "../_lib/nylasGrants.js";
// Nylas accepts a provider hint to skip its account-picker screen. Anything
// else is rejected here rather than passed through, since an unrecognised
// value makes Nylas fail at the redirect with an opaque error.
const PROVIDERS = new Set(["google", "microsoft", "imap", "virtual-calendar"]);
/**
 * Starts the mailbox connection flow for one clinician.
 *
 * Returns the authorization URL rather than issuing a 302: this endpoint sits
 * behind the gateway bearer token, and a browser following a redirect cannot
 * carry that header. The caller (admin SPA) navigates the clinician to the URL.
 */
async function handler(req, res) {
    try {
        requireApiKey(req);
        if (req.method !== "POST") {
            throw new HttpError(405, "method_not_allowed", "only POST is supported");
        }
        const body = (req.body ?? {});
        const providerId = Number(body.provider_id);
        if (!Number.isInteger(providerId)) {
            throw new HttpError(400, "bad_body", "'provider_id' is required and must be an integer");
        }
        const sb = serverClient();
        await assertFkExists(sb, "providers", providerId, "provider_id");
        const provider = body.provider === undefined ? undefined : String(body.provider);
        if (provider !== undefined && !PROVIDERS.has(provider)) {
            throw new HttpError(400, "bad_provider", `'provider' must be one of: ${[...PROVIDERS].join(", ")}`);
        }
        const loginHint = body.login_hint === undefined ? undefined : String(body.login_hint).trim();
        const state = signState(providerId);
        res.status(200).json({
            provider_id: providerId,
            auth_url: hostedAuthUrl({ state, loginHint: loginHint || undefined, provider }),
            state,
            // The window the clinician has to finish authenticating before the link
            // has to be reissued.
            expires_in: STATE_TTL_SECONDS,
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
