const BASE_TYPED = new Set(["id", "status", "created_at", "updated_at"]);
const PATIENTS_TYPED = new Set(["first_name", "last_name", "dob", "mrn", "identity_sub"]);

function typedColumns(table: string): Set<string> {
  if (table === "patients") return new Set([...BASE_TYPED, ...PATIENTS_TYPED]);
  return BASE_TYPED;
}

export type Row = { id: number; data?: Record<string, unknown> } & Record<string, unknown>;

export function splitBody(
  table: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const typed = typedColumns(table);
  const out: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "data" && v && typeof v === "object") {
      Object.assign(data, v as Record<string, unknown>);
    } else if (typed.has(k)) {
      out[k] = v;
    } else {
      data[k] = v;
    }
  }
  if (Object.keys(data).length > 0) out.data = data;
  return out;
}

export function mergeRow(row: Row | null): Row | null {
  if (!row) return row;
  const { data, ...rest } = row;
  if (data && typeof data === "object") {
    return { ...(data as Record<string, unknown>), ...rest } as Row;
  }
  return rest as Row;
}
