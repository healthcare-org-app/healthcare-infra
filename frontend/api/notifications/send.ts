import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { mergeRow, type Row } from "../_lib/rows.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { to, channel, subject, body: msg } = body;
    if (!to || !channel) {
      throw new HttpError(400, "bad_body", "'to' and 'channel' are required");
    }
    const VALID_CHANNELS = new Set(["email", "sms", "push"]);
    if (!VALID_CHANNELS.has(String(channel))) {
      throw new HttpError(400, "bad_channel", `'channel' must be one of: ${[...VALID_CHANNELS].join(", ")}`);
    }
    const sb = serverClient();
    const { data, error } = await sb
      .from("notifications")
      .insert({
        status: "queued",
        data: { to, channel, subject: subject ?? null, body: msg ?? null, queued_at: new Date().toISOString() },
      })
      .select()
      .single();
    if (error) throw new HttpError(400, "db_error", error.message);
    res.status(202).json(mergeRow(data as Row));
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
