import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveResource } from "../_lib/registry.js";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { splitBody, mergeRow, type Row } from "../_lib/rows.js";
import { assertFkExists, assertTransition, computeAdjudication } from "../_lib/businessRules.js";

const BASE_TYPED = new Set(["id", "status", "created_at", "updated_at"]);
const PATIENTS_TYPED = new Set(["first_name", "last_name", "dob", "mrn", "identity_sub"]);

function isTypedFilter(table: string, key: string): boolean {
  if (BASE_TYPED.has(key)) return true;
  if (table === "patients" && PATIENTS_TYPED.has(key)) return true;
  return false;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    const seg = String(req.query.resource ?? "");
    const def = resolveResource(seg);
    if (!def) {
      throw new HttpError(404, "unknown_resource", `no CRUD surface for /api/${seg}`);
    }
    const sb = serverClient();

    if (req.method === "GET") {
      let query = sb.from(def.table).select("*", { count: "exact" });
      let limit = 50;
      let offset = 0;
      for (const [k, raw] of Object.entries(req.query)) {
        if (k === "resource") continue;
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (v === undefined) continue;
        if (k === "limit") {
          limit = Math.min(Number(v) || 50, 500);
        } else if (k === "offset") {
          offset = Number(v) || 0;
        } else if (isTypedFilter(def.table, k)) {
          query = query.eq(k, v);
        } else {
          query = query.eq(`data->>${k}`, v);
        }
      }
      const { data, count, error } = await query.range(offset, offset + limit - 1);
      if (error) throw new HttpError(500, "db_error", error.message);
      const items = (data ?? []).map((r) => mergeRow(r as Row)).filter(Boolean) as Row[];
      res.status(200).json({ count: count ?? items.length, items });
      return;
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (def.table === "eligibility") {
        await assertFkExists(sb, "patients", body.patient_id, "patient_id");
        await assertFkExists(sb, "payer_directory", body.payer_id, "payer_id");
      }

      if (def.table === "claims_adjudication") {
        await assertFkExists(sb, "claims_submission", body.claim_id, "claim_id");
        const { data: claim, error: claimErr } = await sb
          .from("claims_submission")
          .select("id, status, data")
          .eq("id", Number(body.claim_id))
          .maybeSingle();
        if (claimErr) throw new HttpError(500, "db_error", claimErr.message);
        assertTransition("claims_submission", claim?.status as string | undefined, "adjudicated");
        const claimData = (claim as { data?: Record<string, unknown> }).data ?? {};
        const result = computeAdjudication(Number(claimData.amount ?? 0), claimData.diagnosis_codes);
        body.decision = result.decision;
        body.amount_allowed = result.amount_allowed;
        body.denial_reason = result.denial_reason;
      }

      const insertRow = splitBody(def.table, body);
      const { data, error } = await sb.from(def.table).insert(insertRow).select().single();
      if (error) throw new HttpError(400, "db_error", error.message);

      if (def.table === "claims_adjudication") {
        const { error: patchErr } = await sb
          .from("claims_submission")
          .update({ status: "adjudicated", updated_at: new Date().toISOString() })
          .eq("id", Number(body.claim_id));
        if (patchErr) throw new HttpError(500, "db_error", patchErr.message);
      }

      res.status(201).json(mergeRow(data as Row));
      return;
    }

    throw new HttpError(405, "method_not_allowed", `${req.method} not allowed on collection`);
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
