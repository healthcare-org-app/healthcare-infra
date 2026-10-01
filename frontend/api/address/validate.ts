import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { geocodeAddress } from "../_lib/censusGeocoder.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }

    const address = String(req.query.address ?? "").trim();
    if (!address) throw new HttpError(400, "bad_address", "'address' is required");

    const matches = await geocodeAddress(address);
    res.status(200).json({ address, valid: matches.length > 0, matches });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
