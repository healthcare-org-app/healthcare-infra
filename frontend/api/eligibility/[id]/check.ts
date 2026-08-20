import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "bad_id", "id must be numeric");
    const sb = serverClient();
    const { data, error } = await sb
      .from("eligibility")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new HttpError(500, "db_error", error.message);
    if (!data) throw new HttpError(404, "not_found", `no eligibility record with id ${id}`);
    const merged = mergeRow(data as Row);

    if (data.status !== "active") {
      res.status(200).json({
        ...merged,
        checked_at: new Date().toISOString(),
        active: false,
        reason: "coverage_inactive",
      });
      return;
    }

    // Deterministic stand-in for a real payer eligibility call: a stable
    // per-payer plan tier gives a reproducible copay instead of a live quote.
    const PLAN_TIERS = [20, 35, 50];
    const payerId = Number((merged as Record<string, unknown>).payer_id ?? 0);
    const copay = PLAN_TIERS[payerId % PLAN_TIERS.length];

    res.status(200).json({
      ...merged,
      checked_at: new Date().toISOString(),
      active: true,
      copay,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
