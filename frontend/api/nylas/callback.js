import { serverClient } from "../_lib/supabase.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { exchangeCodeForGrant } from "../_lib/nylas.js";
import { saveGrant, verifyState } from "../_lib/nylasGrants.js";
/**
 * OAuth redirect target. Nylas sends the clinician's browser here after they
 * approve (or decline) access.
 *
 * Deliberately NOT behind requireApiKey — a browser redirect carries no bearer
 * header. What stands in for authentication is the signed `state`: it proves
 * this gateway started the flow and names the provider row the grant belongs
 * to. Without that check, anyone who hit this URL with their own auth code
 * could attach their mailbox to an arbitrary clinician record.
 *
 * The authorization code itself is single-use and scoped to our client
 * credentials, so a replayed callback fails at the exchange.
 */
function finish(res, outcome, payload) {
    // When a return URL is configured the clinician lands back in the SPA;
    // otherwise they get JSON, which is what happens during local testing.
    const target = process.env.NYLAS_CONNECT_RETURN_URL;
    if (target) {
        const url = new URL(target);
        url.searchParams.set("nylas", outcome);
        for (const [k, v] of Object.entries(payload)) {
            if (v !== null && v !== undefined)
                url.searchParams.set(k, String(v));
        }
        res.redirect(302, url.toString());
        return;
    }
    res.status(outcome === "connected" ? 200 : 400).json({ status: outcome, ...payload });
}
async function handler(req, res) {
    try {
        if (req.method !== "GET") {
            throw new HttpError(405, "method_not_allowed", "only GET is supported");
        }
        // A declined consent screen comes back as ?error=... with no code. That is
        // a normal outcome, not a fault, so it reports rather than throws.
        const oauthError = req.query.error;
        if (oauthError) {
            finish(res, "error", {
                code: String(oauthError),
                message: String(req.query.error_description ?? "authorization was not granted"),
            });
            return;
        }
        const providerId = verifyState(req.query.state);
        const code = String(req.query.code ?? "").trim();
        if (!code) {
            throw new HttpError(400, "bad_callback", "no authorization 'code' in the callback");
        }
        const grant = await exchangeCodeForGrant(code);
        const sb = serverClient();
        const stored = await saveGrant(sb, providerId, grant);
        // The grant id is a durable credential handle; it stays server-side. Only
        // non-sensitive confirmation detail goes back through the redirect, which
        // lands in browser history and referrer headers.
        await sb.from("notifications").insert({
            status: "sent",
            data: {
                kind: "nylas_grant_connected",
                provider: "nylas",
                provider_id: providerId,
                email: grant.email,
                upstream_provider: grant.provider,
                connected_at: new Date().toISOString(),
            },
        });
        finish(res, "connected", {
            provider_id: stored.provider_id,
            email: stored.email,
            upstream_provider: stored.provider,
        });
    }
    catch (err) {
        // Redirect-mode callers get the failure on the return URL; direct callers
        // get the standard error envelope.
        if (process.env.NYLAS_CONNECT_RETURN_URL && err instanceof HttpError) {
            finish(res, "error", { code: err.code, message: err.message });
            return;
        }
        sendError(res, err);
    }
}
export default withCors(handler);
