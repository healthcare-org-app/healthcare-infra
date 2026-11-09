import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";

// PATCH /api/patients/{id}/contact — update a patient's email and/or phone and
// confirm each change by notification. The record lives on patients-service
// (/api/patients/{id}); the confirmation goes through notifications-service
// (/api/notifications/send). Neither is called until the request is valid and
// authorised, so a rejected request has no side effects.
//
// The confirmation state per channel is stored on the patient record
// (`contact_confirmations`: pending | sent | failed) so that a client retry
// re-sends only a confirmation that has not gone out, never one that has.

const UPSTREAM_TIMEOUT_MS = 3000;
const NOTIFY_ATTEMPTS = 3;
const NOTIFY_BACKOFF_MS = 100;

type Upstream = { name: string; envVar: string };
const PATIENTS: Upstream = { name: "patients-service", envVar: "PATIENTS_API_URL" };
const NOTIFICATIONS: Upstream = { name: "notifications-service", envVar: "NOTIFICATIONS_API_URL" };

type Channel = "email" | "phone";
const CHANNELS: Channel[] = ["email", "phone"];
const NOTIFY_CHANNEL: Record<Channel, "email" | "sms"> = { email: "email", phone: "sms" };

type ConfirmationStatus = "pending" | "sent" | "failed";
type Confirmation = { value: string; status: ConfirmationStatus; updated_at: string };
type Confirmations = Partial<Record<Channel, Confirmation>>;

type Patient = Record<string, unknown>;

function baseUrl(up: Upstream): string {
  const base = process.env[up.envVar] ?? process.env.GATEWAY_BASE_URL;
  if (!base) throw new HttpError(500, "misconfigured", `${up.envVar} (or GATEWAY_BASE_URL) not set`);
  return base.replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GATEWAY_API_KEY ?? ""}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function upstreamError(up: Upstream, status?: number, unreachable = false): HttpError {
  return unreachable
    ? new HttpError(502, "upstream_unavailable", `${up.name} could not be reached`, { upstream: up.name })
    : new HttpError(502, "upstream_error", `${up.name} responded ${status}`, { upstream: up.name, status });
}

async function callJson(
  up: Upstream,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Patient | null }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(up)}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw upstreamError(up, undefined, true);
  }
  if (res.status === 404) return { status: 404, json: null };
  if (!res.ok) throw upstreamError(up, res.status);
  try {
    return { status: res.status, json: (await res.json()) as Patient };
  } catch {
    throw new HttpError(502, "upstream_error", `${up.name} returned a non-JSON body`, { upstream: up.name });
  }
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(422, "invalid_email", "'email' must be a string");
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new HttpError(422, "invalid_email", "'email' is not a valid email address");
  }
  return email;
}

// Normalised to E.164. A bare 10-digit (or 1 + 10-digit) number is read as a
// North American number, matching the clinic's default timezone; anything else
// must carry an explicit "+" country code.
function normalizePhone(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(422, "invalid_phone", "'phone' must be a string");
  const s = raw.trim();
  const bad = () => new HttpError(422, "invalid_phone", "'phone' is not a valid phone number");
  if (!/^\+?[\d\s().-]+$/.test(s)) throw bad();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15) throw bad();
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw bad();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(phone: string): string {
  return `***${phone.slice(-2)}`;
}

function mask(channel: Channel, value: string): string {
  return channel === "email" ? maskEmail(value) : maskPhone(value);
}

function currentValue(patient: Patient, channel: Channel): string | null {
  const v = patient[channel];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Stored phones from before this endpoint existed may not be E.164, so compare
// in normalised form where possible, falling back to the raw string.
function sameValue(channel: Channel, stored: string | null, next: string): boolean {
  if (stored === null) return false;
  try {
    return (channel === "email" ? normalizeEmail(stored) : normalizePhone(stored)) === next;
  } catch {
    return stored === next;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// One confirmation, retried on network errors, timeouts, 429 and 5xx. A 4xx is
// the notifications-service rejecting the request itself, which retrying cannot fix.
async function sendConfirmation(
  patientId: number,
  channel: Channel,
  value: string,
): Promise<{ status: "sent" | "failed"; attempts: number }> {
  const what = channel === "email" ? "email address" : "phone number";
  const payload = {
    to: value,
    channel: NOTIFY_CHANNEL[channel],
    subject: `Your ${what} was updated`,
    body: `The ${what} on your patient record was changed. If you did not request this, contact your clinic.`,
  };
  const idempotencyKey = `contact-confirm:${patientId}:${channel}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
  for (let attempt = 1; attempt <= NOTIFY_ATTEMPTS; attempt++) {
    let retryable = true;
    try {
      const res = await fetch(`${baseUrl(NOTIFICATIONS)}/api/notifications/send`, {
        method: "POST",
        headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.ok) return { status: "sent", attempts: attempt };
      retryable = res.status === 429 || res.status >= 500;
    } catch (err) {
      if (err instanceof HttpError) throw err;
    }
    if (!retryable) return { status: "failed", attempts: attempt };
    if (attempt < NOTIFY_ATTEMPTS) await sleep(NOTIFY_BACKOFF_MS * 2 ** (attempt - 1));
  }
  return { status: "failed", attempts: NOTIFY_ATTEMPTS };
}

function parseBody(raw: unknown): Partial<Record<Channel, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "bad_body", "body must be a JSON object with 'email' and/or 'phone'");
  }
  const body = raw as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !CHANNELS.includes(k as Channel));
  if (unknown.length > 0) {
    throw new HttpError(400, "unknown_field", `only 'email' and 'phone' can be updated here, got: ${unknown.join(", ")}`);
  }
  const present = CHANNELS.filter((c) => c in body);
  if (present.length === 0) {
    throw new HttpError(400, "empty_update", "provide 'email' and/or 'phone'");
  }
  const out: Partial<Record<Channel, string>> = {};
  for (const c of present) out[c] = c === "email" ? normalizeEmail(body[c]) : normalizePhone(body[c]);
  return out;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "PATCH") {
      throw new HttpError(405, "method_not_allowed", "only PATCH is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "bad_id", "id must be a positive integer");
    const requested = parseBody(req.body);

    const found = await callJson(PATIENTS, "GET", `/api/patients/${id}`);
    if (!found.json) throw new HttpError(404, "not_found", `no patient with id ${id}`);
    const patient = found.json;
    const confirmations = ((patient.contact_confirmations ?? {}) as Confirmations) ?? {};

    const now = new Date().toISOString();
    const changed: Channel[] = [];
    const toConfirm: Channel[] = [];
    for (const c of Object.keys(requested) as Channel[]) {
      const next = requested[c] as string;
      if (!sameValue(c, currentValue(patient, c), next)) {
        changed.push(c);
        toConfirm.push(c);
      } else if (confirmations[c]?.value === next && confirmations[c]?.status !== "sent") {
        toConfirm.push(c);
      }
    }

    let record = patient;
    if (changed.length > 0) {
      const patch: Record<string, unknown> = {};
      const nextConfirmations: Confirmations = { ...confirmations };
      for (const c of changed) {
        patch[c] = requested[c];
        nextConfirmations[c] = { value: requested[c] as string, status: "pending", updated_at: now };
      }
      patch.contact_confirmations = nextConfirmations;
      const written = await callJson(PATIENTS, "PATCH", `/api/patients/${id}`, patch);
      if (!written.json) throw new HttpError(404, "not_found", `no patient with id ${id}`);
      record = written.json;
    }

    const results: { channel: Channel; to: string; status: "sent" | "failed"; attempts: number }[] = [];
    for (const c of toConfirm) {
      const value = requested[c] as string;
      const outcome = await sendConfirmation(id, c, value);
      results.push({ channel: c, to: mask(c, value), ...outcome });
    }

    if (results.length > 0) {
      const settled: Confirmations = { ...((record.contact_confirmations ?? confirmations) as Confirmations) };
      const stamp = new Date().toISOString();
      for (const r of results) {
        settled[r.channel] = { value: requested[r.channel] as string, status: r.status, updated_at: stamp };
      }
      try {
        const written = await callJson(PATIENTS, "PATCH", `/api/patients/${id}`, { contact_confirmations: settled });
        if (written.json) record = written.json;
      } catch {
        // The contact change and the notification already happened; the record
        // still says "pending", so a retry may resend one confirmation.
      }
    }

    res.status(200).json({
      patient: record,
      changed,
      notifications: results,
      ...(results.some((r) => r.status === "failed")
        ? { warnings: ["contact details were saved but a confirmation notification could not be delivered; retry the same request to resend it"] }
        : {}),
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
