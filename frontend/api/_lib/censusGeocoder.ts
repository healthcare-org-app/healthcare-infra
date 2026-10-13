import { HttpError } from "./errors.js";

// US Census Bureau Geocoder. Public, unauthenticated, no API key or rate
// limit documented. Does not support CORS, so it must be called server-side.
const BASE_URL = "https://geocoding.geo.census.gov/geocoder";
const BENCHMARK = "4"; // Public_AR_Current — current public address ranges

async function request(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ ...params, benchmark: BENCHMARK, format: "json" });

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
    throw new HttpError(resp.status === 400 ? 400 : 502, `census_http_${resp.status}`, `Census geocoder returned ${resp.status}`);
  }
  return parsed;
}

export type GeocodedAddress = {
  matchedAddress: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  zip: string | null;
};

function asGeocodedAddress(match: Record<string, unknown>): GeocodedAddress {
  const coordinates = (match.coordinates ?? {}) as Record<string, unknown>;
  const components = (match.addressComponents ?? {}) as Record<string, unknown>;
  return {
    matchedAddress: String(match.matchedAddress ?? ""),
    latitude: Number(coordinates.y),
    longitude: Number(coordinates.x),
    city: typeof components.city === "string" ? components.city : null,
    state: typeof components.state === "string" ? components.state : null,
    zip: typeof components.zip === "string" ? components.zip : null,
  };
}

/**
 * Validates and geocodes a single-line US address. Returns an empty array
 * when the geocoder finds no match — the Census API models "no match" as a
 * 200 with an empty `addressMatches` list rather than an error status.
 */
export async function geocodeAddress(oneLineAddress: string): Promise<GeocodedAddress[]> {
  const body = await request("/locations/onelineaddress", { address: oneLineAddress });
  const result = (body.result ?? {}) as Record<string, unknown>;
  const matches = Array.isArray(result.addressMatches) ? result.addressMatches : [];
  return matches.map((m) => asGeocodedAddress(m as Record<string, unknown>));
}
