import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "./_lib/supabase.js";
import { withCors } from "./_lib/cors.js";
import { sendError } from "./_lib/errors.js";

async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const ts = new Date().toISOString();
  try {
    const sb = serverClient();
    const { error } = await sb.from("patients").select("id").limit(1);
    res.status(200).json({
      status: "ok",
      supabase: error ? "down" : "reachable",
      supabase_error: error?.message,
      ts,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
