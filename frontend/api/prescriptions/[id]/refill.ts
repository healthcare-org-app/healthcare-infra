import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "bad_id", "id must be numeric");
    const sb = serverClient();
    const { data: script, error: readErr } = await sb
      .from("prescriptions")
      .select("id, data")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, "db_error", readErr.message);
    if (!script) throw new HttpError(404, "not_found", `no prescription with id ${id}`);
    const now = new Date().toISOString();
    const { data: refill, error } = await sb
      .from("refills")
      .insert({
        status: "requested",
        data: { prescription_id: id, requested_at: now },
      })
      .select()
      .single();
    if (error) throw new HttpError(400, "db_error", error.message);
    res.status(201).json(mergeRow(refill as Row));
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
