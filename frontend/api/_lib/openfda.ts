import { HttpError } from "./errors.js";

// openFDA. Unauthenticated reads work at a lower rate limit; api_key just
// raises the ceiling (240 req/min, 1,000/day per IP -> 120,000/day with a key).
const BASE_URL = "https://api.fda.gov";

function apiKey(): string | undefined {
  return process.env.OPENFDA_API_KEY?.trim() || undefined;
}

/**
 * Maps openFDA's status onto ours.
 *
 * 400 rides through as-is: it means the caller's own `search` expression was
 * malformed, so it's *our* caller's mistake to fix, not a gateway problem.
 * 404 means openFDA matched no labels — not an error so much as an empty
 * result, but openFDA models it as 404 rather than a 200 with `results: []`.
 */
function mapStatus(providerStatus: number): number {
  switch (providerStatus) {
    case 400:
      return 400;
    case 404:
      return 404;
    case 429:
      return 429;
    default:
      return 502;
  }
}

async function request(path: string, params: Record<string, string | number>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  const key = apiKey();
  if (key) query.set("api_key", key);

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}${path}?${query.toString()}`);
  } catch (err) {
    throw new HttpError(502, "provider_unreachable", err instanceof Error ? err.message : String(err));
  }

  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
  }

  if (!resp.ok) {
    const error = (parsed.error ?? {}) as Record<string, unknown>;
    const code = String(error.code ?? `http_${resp.status}`);
    const message = String(error.message ?? `openFDA returned ${resp.status}`);
    throw new HttpError(mapStatus(resp.status), `openfda_${code}`, message);
  }
  return parsed;
}

export type DrugLabel = {
  brand_name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  active_ingredients: string[];
  inactive_ingredients: string[];
};

function first(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asDrugLabel(raw: Record<string, unknown>): DrugLabel {
  const openfda = (raw.openfda ?? {}) as Record<string, unknown>;
  return {
    brand_name: first(openfda.brand_name),
    generic_name: first(openfda.generic_name),
    manufacturer: first(openfda.manufacturer_name),
    active_ingredients: stringArray(raw.active_ingredient),
    inactive_ingredients: stringArray(raw.inactive_ingredient),
  };
}

/**
 * Searches FDA structured product labels by brand or generic name and
 * returns each match's active/inactive ingredient sections.
 *
 * A search that reaches no results is openFDA's `404 NOT_FOUND` — mapped
 * back to an empty array here rather than an error, since "no drug matched"
 * is a normal, expected outcome of a search.
 */
export async function searchDrugLabels(name: string, limit: number): Promise<DrugLabel[]> {
  const escaped = name.replace(/"/g, '\\"');
  const search = `openfda.brand_name:"${escaped}"+OR+openfda.generic_name:"${escaped}"`;
  try {
    const body = await request("/drug/label.json", { search, limit });
    const results = Array.isArray(body.results) ? body.results : [];
    return results.map((r) => asDrugLabel(r as Record<string, unknown>));
  } catch (err) {
    if (err instanceof HttpError && err.code === "openfda_NOT_FOUND") return [];
    throw err;
  }
}
