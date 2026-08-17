import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { mergeRow, type Row } from "../_lib/rows.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }
    const qRaw = req.query.q;
    const q = String(Array.isArray(qRaw) ? qRaw[0] : (qRaw ?? "")).trim();
    if (!q) throw new HttpError(400, "missing_q", "query parameter 'q' is required");
    const limitRaw = req.query.limit;
    const limit = Math.min(
      Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw) || 20,
      100,
    );
    const like = `%${q}%`;
    const sb = serverClient();
    const { data, error, count } = await sb
      .from("patients")
      .select("*", { count: "exact" })
      .or(`first_name.ilike.${like},last_name.ilike.${like},mrn.ilike.${like}`)
      .limit(limit);
    if (error) throw new HttpError(500, "db_error", error.message);
    const items = (data ?? []).map((r) => mergeRow(r as Row)).filter(Boolean) as Row[];
    res.status(200).json({ count: count ?? items.length, items });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
