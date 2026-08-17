import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveResource } from "../_lib/registry.js";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { splitBody, mergeRow, type Row } from "../_lib/rows.js";

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    const seg = String(req.query.resource ?? "");
    const idStr = String(req.query.id ?? "");
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      throw new HttpError(400, "bad_id", `id must be numeric, got "${idStr}"`);
    }
    const def = resolveResource(seg);
    if (!def) {
      throw new HttpError(404, "unknown_resource", `no CRUD surface for /api/${seg}`);
    }
    const sb = serverClient();

    if (req.method === "GET") {
      const { data, error } = await sb.from(def.table).select("*").eq("id", id).maybeSingle();
      if (error) throw new HttpError(500, "db_error", error.message);
      if (!data) throw new HttpError(404, "not_found", `no ${def.url} with id ${id}`);
      res.status(200).json(mergeRow(data as Row));
      return;
    }

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch = splitBody(def.table, body);
      // Merge JSONB rather than replacing when caller sends nested fields.
      if (patch.data) {
        const { data: existing, error: readErr } = await sb
          .from(def.table)
          .select("data")
          .eq("id", id)
          .maybeSingle();
        if (readErr) throw new HttpError(500, "db_error", readErr.message);
        if (!existing) throw new HttpError(404, "not_found", `no ${def.url} with id ${id}`);
        const merged = {
          ...((existing as { data?: Record<string, unknown> }).data ?? {}),
          ...(patch.data as Record<string, unknown>),
        };
        patch.data = merged;
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await sb
        .from(def.table)
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new HttpError(400, "db_error", error.message);
      res.status(200).json(mergeRow(data as Row));
      return;
    }

    if (req.method === "DELETE") {
      const { error } = await sb.from(def.table).delete().eq("id", id);
      if (error) throw new HttpError(400, "db_error", error.message);
      res.status(200).json({ deleted: true, id });
      return;
    }

    throw new HttpError(405, "method_not_allowed", `${req.method} not allowed on record`);
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
