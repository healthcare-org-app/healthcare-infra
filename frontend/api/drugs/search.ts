import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { searchDrugLabels } from "../_lib/openfda.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }

    const q = String(req.query.q ?? "").trim();
    if (!q) throw new HttpError(400, "bad_query", "'q' is required");

    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new HttpError(400, "bad_limit", `'limit' must be an integer 1-${MAX_LIMIT}`);
    }

    const results = await searchDrugLabels(q, limit);
    res.status(200).json({ query: q, count: results.length, results });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
