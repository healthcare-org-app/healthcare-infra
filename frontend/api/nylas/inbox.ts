import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { getMessage, listMessages, sendMessage } from "../_lib/nylas.js";
import { requireGrant } from "../_lib/nylasGrants.js";

const MAX_LIMIT = 200;

function optional(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s || undefined;
}

function boolParam(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  const s = String(value).toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  throw new HttpError(400, "bad_param", `'${name}' must be true or false`);
}

/**
 * GET  — reads a clinician's connected inbox.
 * POST — sends mail from it (as them, not from a clinic-wide sender address).
 *
 * Message *bodies* are deliberately not returned by the list view. A clinician
 * mailbox holds PHI, and the list is what the admin UI renders wholesale;
 * callers that need a body fetch the single message explicitly.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    const sb = serverClient();

    if (req.method === "GET") {
      const grant = await requireGrant(sb, req.query.provider_id);

      // `?message_id=` opens one message, body included. That read is logged;
      // listing is not, because listing exposes no content.
      const messageId = optional(req.query.message_id);
      if (messageId) {
        const message = await getMessage(grant.grant_id, messageId);
        const { error: auditErr } = await sb.from("audit_log").insert({
          status: "recorded",
          data: {
            kind: "nylas_message_read",
            provider_id: grant.provider_id,
            mailbox: grant.email,
            nylas_message_id: messageId,
            read_at: new Date().toISOString(),
          },
        });
        if (auditErr) throw new HttpError(500, "db_error", auditErr.message);
        res.status(200).json({ provider_id: grant.provider_id, mailbox: grant.email, message });
        return;
      }

      const limitRaw = req.query.limit;
      const limit = limitRaw === undefined ? 25 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new HttpError(400, "bad_limit", `'limit' must be an integer 1–${MAX_LIMIT}`);
      }

      const page = await listMessages(grant.grant_id, {
        limit,
        pageToken: optional(req.query.page_token),
        unread: boolParam(req.query.unread, "unread"),
        from: optional(req.query.from),
        subject: optional(req.query.subject),
        in: optional(req.query.in),
        searchQueryNative: optional(req.query.q),
      });

      res.status(200).json({
        provider_id: grant.provider_id,
        mailbox: grant.email,
        count: page.items.length,
        next_cursor: page.next_cursor,
        messages: page.items,
      });
      return;
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const grant = await requireGrant(sb, body.provider_id);

      const to = Array.isArray(body.to) ? body.to : [];
      const recipients = to
        .map((entry) => {
          const r = (entry ?? {}) as Record<string, unknown>;
          const email = String(r.email ?? "").trim();
          return email ? { email, name: optional(r.name) } : null;
        })
        .filter((r): r is { email: string; name: string | undefined } => r !== null);
      if (recipients.length === 0) {
        throw new HttpError(400, "bad_body", "'to' must be a non-empty array of { email }");
      }

      const subject = String(body.subject ?? "").trim();
      if (!subject) throw new HttpError(400, "bad_body", "'subject' is required");
      const messageBody = String(body.body ?? "");
      if (!messageBody) throw new HttpError(400, "bad_body", "'body' is required");

      const sent = await sendMessage(grant.grant_id, {
        to: recipients,
        subject,
        body: messageBody,
        replyToMessageId: optional(body.reply_to_message_id),
        // Scoped so a retried send replays rather than duplicating. Callers
        // that send distinct messages must vary this.
        idempotencyKey: optional(body.idempotency_key),
      });

      const { error: notifErr } = await sb.from("notifications").insert({
        status: "sent",
        data: {
          kind: "nylas_message_sent",
          provider: "nylas",
          provider_id: grant.provider_id,
          from: grant.email,
          // Recipients and subject only — the body is PHI and does not belong
          // in a notifications row that the generic CRUD reader can list.
          to: recipients.map((r) => r.email),
          subject,
          nylas_message_id: sent.id,
          nylas_thread_id: sent.thread_id,
          sent_at: new Date().toISOString(),
        },
      });
      if (notifErr) throw new HttpError(500, "db_error", notifErr.message);

      res.status(200).json({
        provider_id: grant.provider_id,
        from: grant.email,
        message_id: sent.id,
        thread_id: sent.thread_id,
        delivery_status: "sent",
      });
      return;
    }

    throw new HttpError(405, "method_not_allowed", "only GET and POST are supported");
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
