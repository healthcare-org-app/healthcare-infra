import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./errors.js";

export async function assertFkExists(
  sb: SupabaseClient,
  table: string,
  id: unknown,
  field: string,
): Promise<void> {
  if (id === undefined || id === null || id === "") {
    throw new HttpError(422, "fk_missing", `'${field}' is required`);
  }
  const { data, error } = await sb.from(table).select("id").eq("id", Number(id)).maybeSingle();
  if (error) throw new HttpError(500, "db_error", error.message);
  if (!data) {
    throw new HttpError(422, "fk_not_found", `${field}=${id} does not exist in ${table}`);
  }
}

type TransitionMap = Record<string, string[]>;

// "active" is the DB column default and what every generic "Create X" Postman
// request sends as `status`; "scheduled"/"submitted" cover the hand-seeded rows
// in supabase-fix.sql that set a domain-specific initial status explicitly.
const TRANSITIONS: Record<string, TransitionMap> = {
  appointments: {
    active: ["checked-in", "cancelled"],
    scheduled: ["checked-in", "cancelled"],
    "checked-in": ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  },
  claims_submission: {
    active: ["adjudicated"],
    submitted: ["adjudicated"],
    adjudicated: [],
  },
};

export function assertTransition(table: string, from: string | null | undefined, to: string): void {
  const machine = TRANSITIONS[table];
  if (!machine) return;
  const allowed = machine[from ?? ""];
  if (!allowed || !allowed.includes(to)) {
    throw new HttpError(
      409,
      "illegal_transition",
      `cannot move ${table} from "${from ?? "(none)"}" to "${to}"`,
    );
  }
}

export type AdjudicationResult = {
  decision: "approved" | "denied";
  amount_allowed: number;
  denial_reason: string | null;
};

// Deterministic stand-in for a real payer adjudication call: preventive/wellness
// codes (Z-prefixed, e.g. annual physicals) are covered in full; anything over
// the policy threshold is denied outright; everything else pays out at 90%.
export function computeAdjudication(billedAmount: number, diagnosisCodes: unknown): AdjudicationResult {
  const codes = String(diagnosisCodes ?? "");
  const isPreventive = /^Z/i.test(codes.trim());
  const POLICY_THRESHOLD = 300;

  if (isPreventive) {
    return { decision: "approved", amount_allowed: billedAmount, denial_reason: null };
  }
  if (billedAmount > POLICY_THRESHOLD) {
    return { decision: "denied", amount_allowed: 0, denial_reason: "amount_exceeds_policy_threshold" };
  }
  return { decision: "approved", amount_allowed: Math.round(billedAmount * 0.9 * 100) / 100, denial_reason: null };
}
