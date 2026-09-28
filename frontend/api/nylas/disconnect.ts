import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { revokeGrant } from "../_lib/nylas.js";
import { markRevoked, requireGrant } from "../_lib/nylasGrants.js";

/**
 * Disconnects a clinician's mailbox.
 *
 * Revokes upstream first, then marks the local row. That order matters: if the
 * local write succeeded first and the revoke then failed, we would have lost
 * the grant id we need to revoke with, leaving Nylas holding live access to a
 * clinician's mail with no way for us to withdraw it.
 *
 * The local row is kept (status "revoked") rather than deleted, so the audit
 * trail of who connected what, and when, survives the disconnection.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const sb = serverClient();
    const grant = await requireGrant(sb, body.provider_id);

    await revokeGrant(grant.grant_id);
    await markRevoked(sb, grant.row_id);

    const revokedAt = new Date().toISOString();
    const { error: notifErr } = await sb.from("notifications").insert({
      status: "sent",
      data: {
        kind: "nylas_grant_revoked",
        provider: "nylas",
        provider_id: grant.provider_id,
        email: grant.email,
        revoked_at: revokedAt,
      },
    });
    if (notifErr) throw new HttpError(500, "db_error", notifErr.message);

    res.status(200).json({
      provider_id: grant.provider_id,
      mailbox: grant.email,
      status: "revoked",
      revoked_at: revokedAt,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
