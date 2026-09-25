import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./errors.js";
import { mergeRow, type Row } from "./rows.js";
import type { NylasGrant } from "./nylas.js";

// Nylas grants live as rows in `email_gateway` — the Communications-domain
// table that already fronts outbound mail. Every table in this schema is the
// same (id, data jsonb, status) shape, so the discriminator is `data.kind`.
const TABLE = "email_gateway";
const KIND = "nylas_grant";

// The OAuth `state` is only valid briefly. A code that comes back later than
// this is either a replay or a tab someone left open for an hour.
export const STATE_TTL_SECONDS = 600;

export type StoredGrant = {
  row_id: number;
  provider_id: number;
  grant_id: string;
  email: string | null;
  provider: string | null;
  status: string;
};

function stateSecret(): string {
  // Reuses the gateway key rather than introducing a second secret to rotate.
  // The state is a short-lived integrity tag, not a bearer credential — it
  // proves *we* started this flow, and it is useless once redeemed.
  const key = process.env.GATEWAY_API_KEY;
  if (!key) {
    throw new HttpError(500, "misconfigured", "GATEWAY_API_KEY is not set");
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("hex");
}

/**
 * Mints an opaque `state` binding this OAuth attempt to one provider row.
 *
 * The callback runs unauthenticated — Nylas redirects a browser to it, and a
 * browser cannot present the gateway bearer token. The signature is what stops
 * an attacker from calling the callback with a code of their own and having us
 * attach their mailbox to someone else's provider record.
 */
export function signState(providerId: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${providerId}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: unknown): number {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 3) {
    throw new HttpError(400, "bad_state", "state parameter is malformed");
  }
  const [providerRaw, issuedRaw, mac] = parts;
  const expected = sign(`${providerRaw}.${issuedRaw}`);

  // Compare as fixed-length buffers; a length mismatch would make
  // timingSafeEqual throw rather than return false.
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(400, "bad_state", "state signature does not verify");
  }

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) {
    throw new HttpError(400, "bad_state", "state timestamp is not a number");
  }
  if (Math.floor(Date.now() / 1000) - issuedAt > STATE_TTL_SECONDS) {
    throw new HttpError(400, "state_expired", "authorization link expired — start the flow again");
  }

  const providerId = Number(providerRaw);
  if (!Number.isInteger(providerId)) {
    throw new HttpError(400, "bad_state", "state carries a non-numeric provider id");
  }
  return providerId;
}

function asStoredGrant(row: Row): StoredGrant {
  const merged = mergeRow(row) as Record<string, unknown>;
  return {
    row_id: Number(merged.id),
    provider_id: Number(merged.provider_id),
    grant_id: String(merged.grant_id),
    email: merged.email ? String(merged.email) : null,
    provider: merged.provider ? String(merged.provider) : null,
    status: String(merged.status ?? "active"),
  };
}

async function findRow(
  sb: SupabaseClient,
  providerId: number,
): Promise<Row | null> {
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .contains("data", { kind: KIND, provider_id: providerId })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw new HttpError(500, "db_error", error.message);
  const rows = (data ?? []) as Row[];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Persists a freshly minted grant against a provider, replacing any prior one.
 *
 * Reconnecting is expected — tokens get revoked provider-side, staff change
 * mailboxes — and each reconnect mints a *new* grant_id. Overwriting in place
 * rather than inserting keeps one live grant per provider, so callers never
 * have to disambiguate which of several rows is current.
 */
export async function saveGrant(
  sb: SupabaseClient,
  providerId: number,
  grant: NylasGrant,
): Promise<StoredGrant> {
  const existing = await findRow(sb, providerId);
  const payload = {
    kind: KIND,
    provider_id: providerId,
    grant_id: grant.grant_id,
    email: grant.email,
    provider: grant.provider,
    scope: grant.scope,
    connected_at: new Date().toISOString(),
  };

  if (existing) {
    const previous = (existing.data ?? {}) as Record<string, unknown>;
    const { data, error } = await sb
      .from(TABLE)
      .update({
        status: "active",
        // Keep whatever else the row carried; only the grant fields move.
        data: { ...previous, ...payload },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new HttpError(500, "db_error", error.message);
    return asStoredGrant(data as Row);
  }

  const { data, error } = await sb
    .from(TABLE)
    .insert({ status: "active", data: payload })
    .select()
    .single();
  if (error) throw new HttpError(500, "db_error", error.message);
  return asStoredGrant(data as Row);
}

/** Loads the live grant for a provider, or explains why there isn't one. */
export async function requireGrant(
  sb: SupabaseClient,
  providerId: unknown,
): Promise<StoredGrant> {
  const id = Number(providerId);
  if (!Number.isInteger(id)) {
    throw new HttpError(400, "bad_provider_id", "'provider_id' must be an integer");
  }
  const row = await findRow(sb, id);
  if (!row) {
    throw new HttpError(
      409,
      "not_connected",
      `provider ${id} has no connected mailbox — POST /api/nylas/connect first`,
    );
  }
  const grant = asStoredGrant(row);
  if (grant.status !== "active") {
    throw new HttpError(
      409,
      "grant_revoked",
      `provider ${id}'s mailbox connection is "${grant.status}" — reconnect to restore it`,
    );
  }
  return grant;
}

/** Marks a grant inactive locally. Upstream revocation is the caller's job. */
export async function markRevoked(sb: SupabaseClient, rowId: number): Promise<void> {
  const { error } = await sb
    .from(TABLE)
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw new HttpError(500, "db_error", error.message);
}
