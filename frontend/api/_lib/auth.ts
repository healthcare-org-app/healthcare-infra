import type { VercelRequest } from "@vercel/node";
import { HttpError } from "./errors.js";

export function requireApiKey(req: VercelRequest): void {
  const expected = process.env.GATEWAY_API_KEY;
  if (!expected) {
    throw new HttpError(500, "misconfigured", "gateway API key not set");
  }
  const header = req.headers["authorization"];
  const auth = Array.isArray(header) ? header[0] : header;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "unauthorized", "missing bearer token");
  }
  const token = auth.slice(7).trim();
  if (token !== expected) {
    throw new HttpError(401, "unauthorized", "invalid bearer token");
  }
}
