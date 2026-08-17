// API layer — talks to Supabase (PostgREST auto-generated REST) via supabase-js.
// Preserves the same interface (list/get/create/update/remove/action) so the
// pages don't care about the backend swap.
//
// Naming: each service in services.ts has a `resource` field which is also the
// Postgres table name (e.g. patients-service → patients). One or two services
// have overrides tracked in RESOURCE_TO_TABLE at the bottom of this file.

import { supabase } from "@/supabase";

export interface ListResponse<T = Row> {
  count: number;
  items: T[];
}

export type Row = {
  id: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
} & Record<string, unknown>;

const PREFIX_TO_TABLE: Record<string, string> = {};

// Build the /api/<x> → table map from the service registry.
// This runs once at module load.
import { SERVICES } from "@/services";
for (const s of SERVICES) {
  // Extract table name from prefix: /api/patients → patients
  const table = s.prefix.replace(/^\/api\//, "").replace(/-/g, "_");
  PREFIX_TO_TABLE[s.prefix] = table;
}

// Typed top-level columns in patients (all other services use data JSONB).
const PATIENTS_TYPED_COLS = new Set([
  "first_name",
  "last_name",
  "dob",
  "mrn",
  "identity_sub",
]);
const BASE_TYPED_COLS = new Set(["id", "status", "created_at", "updated_at"]);

function tableFor(prefix: string): string {
  return PREFIX_TO_TABLE[prefix] ?? prefix.replace(/^\/api\//, "").replace(/-/g, "_");
}

function applyFilters(
  q: ReturnType<typeof supabase.from>["select"] extends (...a: any[]) => infer R ? R : never,
  table: string,
  params: Record<string, string>,
): typeof q {
  let query = q as any;
  for (const [k, v] of Object.entries(params)) {
    if (k === "limit") {
      query = query.limit(Number(v));
    } else if (k === "offset") {
      const off = Number(v);
      query = query.range(off, off + 49);
    } else if (BASE_TYPED_COLS.has(k) || (table === "patients" && PATIENTS_TYPED_COLS.has(k))) {
      query = query.eq(k, v);
    } else {
      // JSONB field — PostgREST syntax `data->>key=eq.value`
      query = query.eq(`data->>${k}`, v);
    }
  }
  return query;
}

// Merge the JSONB `data` field back into the top-level object so callers see
// the same shape the old Flask backend returned.
function unwrap<T extends Row>(row: T | null | undefined): T | undefined {
  if (!row) return undefined;
  const { data, ...rest } = row as Row & { data?: Record<string, unknown> };
  return { ...(data ?? {}), ...rest } as T;
}

function unwrapAll<T extends Row>(rows: T[]): T[] {
  return rows.map((r) => unwrap(r)!);
}

// Split incoming write body into (typed columns, JSONB payload).
function splitBody(
  table: string,
  body: Record<string, unknown>,
): { top: Record<string, unknown>; data: Record<string, unknown> } {
  const top: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "id" || k === "created_at" || k === "updated_at") continue;
    if (k === "status") top.status = v;
    else if (table === "patients" && PATIENTS_TYPED_COLS.has(k)) top[k] = v;
    else data[k] = v;
  }
  return { top, data };
}

export const api = {
  async list<T = Row>(
    prefix: string,
    params: Record<string, string> = {},
  ): Promise<ListResponse<T>> {
    const table = tableFor(prefix);
    let q = supabase.from(table).select("*", { count: "exact" });
    q = applyFilters(q, table, params);
    // Default reasonable page size if no limit given.
    if (!params.limit) q = q.limit(50);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? (data?.length ?? 0), items: unwrapAll(data ?? []) as T[] };
  },

  async get<T = Row>(prefix: string, id: number | string): Promise<T> {
    const table = tableFor(prefix);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return unwrap(data as Row) as T;
  },

  async create<T = Row>(prefix: string, body: unknown): Promise<T> {
    const table = tableFor(prefix);
    const { top, data: jsonb } = splitBody(table, body as Record<string, unknown>);
    const payload: Record<string, unknown> = { ...top, data: jsonb };
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return unwrap(data as Row) as T;
  },

  async update<T = Row>(
    prefix: string,
    id: number | string,
    body: unknown,
  ): Promise<T> {
    const table = tableFor(prefix);
    const { top, data: jsonbUpdate } = splitBody(table, body as Record<string, unknown>);
    // For JSONB partial updates, merge with existing.
    const patch: Record<string, unknown> = { ...top };
    if (Object.keys(jsonbUpdate).length) {
      // Fetch current, merge, then patch. Two round trips but safe.
      const current = await api.get<Row>(prefix, id);
      const currentData = (current as any).data ?? {};
      patch.data = { ...currentData, ...jsonbUpdate };
    }
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return unwrap(data as Row) as T;
  },

  async remove(prefix: string, id: number | string): Promise<{ deactivated: number }> {
    const table = tableFor(prefix);
    // Soft delete — mirror the Flask backend's DELETE behavior.
    const { error } = await supabase
      .from(table)
      .update({ status: "deactivated" })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { deactivated: Number(id) };
  },

  async action<T = unknown>(
    _prefix: string,
    _id: number | string | null,
    path: string,
    _method: "POST" | "GET" = "POST",
    _body?: unknown,
  ): Promise<T> {
    // Service-specific side actions (cancel/check-in/refill/send/check) haven't
    // been ported to Supabase yet — they need Postgres functions (RPC) or Edge
    // Functions. For now, throw a clear error.
    throw new Error(
      `Custom action '${path}' not implemented on Supabase yet. ` +
        `Wire an RPC or Edge Function to enable this button.`,
    );
  },
};
