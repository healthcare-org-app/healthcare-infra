import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";

const DEFAULT_REFILLS_REMAINING = 3;

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
      .select("id, status, data")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, "db_error", readErr.message);
    if (!script) throw new HttpError(404, "not_found", `no prescription with id ${id}`);
    if (script.status === "cancelled") {
      throw new HttpError(409, "prescription_cancelled", `prescription ${id} is cancelled`);
    }
    const scriptData = (script.data as Record<string, unknown>) ?? {};
    const remaining =
      typeof scriptData.refills_remaining === "number"
        ? scriptData.refills_remaining
        : DEFAULT_REFILLS_REMAINING;
    if (remaining <= 0) {
      throw new HttpError(409, "no_refills_remaining", `prescription ${id} has no refills remaining`);
    }

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

    const { error: patchErr } = await sb
      .from("prescriptions")
      .update({
        data: { ...scriptData, refills_remaining: remaining - 1 },
        updated_at: now,
      })
      .eq("id", id);
    if (patchErr) throw new HttpError(500, "db_error", patchErr.message);

    res.status(201).json(mergeRow(refill as Row));
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
