import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";
import { assertTransition } from "../../_lib/businessRules.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "bad_id", "id must be numeric");
    const sb = serverClient();
    const { data: current, error: readErr } = await sb
      .from("appointments")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, "db_error", readErr.message);
    if (!current) throw new HttpError(404, "not_found", `no appointment with id ${id}`);
    assertTransition("appointments", current.status as string | undefined, "checked-in");
    const { data, error } = await sb
      .from("appointments")
      .update({ status: "checked-in", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new HttpError(400, "db_error", error.message);
    res.status(200).json(mergeRow(data as Row));
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
