import { HttpError } from "./errors.js";

// PurgoMalum. Public, unauthenticated, no API key or documented rate
// limit. Filters/replaces profanity server-side; the caller supplies the
// replacement style (fill_text/fill_char) rather than us picking one.
const BASE_URL = "https://www.purgomalum.com/service/json";

export type FilterOptions = {
  add?: string;
  fillText?: string;
  fillChar?: string;
};

async function request(params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}?${query.toString()}`);
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

  // A 400 here means our caller's own fill_text/add was malformed — that's
  // our caller's mistake to fix, not a gateway/provider problem.
  if (!resp.ok) {
    const message = typeof parsed.error === "string" ? parsed.error : `PurgoMalum returned ${resp.status}`;
    throw new HttpError(resp.status === 400 ? 400 : 502, "purgomalum_error", message);
  }
  return parsed;
}

/**
 * Filters profanity out of `text`, returning the processed result.
 * `add` extends the blocklist for this request only; `fillText`/`fillChar`
 * control what matched words are replaced with.
 */
export async function filterText(text: string, options: FilterOptions = {}): Promise<string> {
  const params: Record<string, string> = { text };
  if (options.add) params.add = options.add;
  if (options.fillText !== undefined) params.fill_text = options.fillText;
  if (options.fillChar !== undefined) params.fill_char = options.fillChar;

  const body = await request(params);
  return typeof body.result === "string" ? body.result : text;
}
