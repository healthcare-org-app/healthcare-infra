import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { filterText } from "../_lib/purgomalum.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }

    const text = String(req.query.text ?? "");
    if (!text) throw new HttpError(400, "bad_text", "'text' is required");

    const add = req.query.add !== undefined ? String(req.query.add) : undefined;
    const fillText = req.query.fill_text !== undefined ? String(req.query.fill_text) : undefined;
    const fillChar = req.query.fill_char !== undefined ? String(req.query.fill_char) : undefined;

    const filtered = await filterText(text, { add, fillText, fillChar });
    res.status(200).json({ text, filtered, changed: filtered !== text });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
