import { HttpError } from "./errors.js";

// PayPal Invoicing v2. Unlike Nylas, there is no long-lived API key: the
// client id/secret pair is exchanged for a short-lived OAuth2 access token via
// client_credentials, and every invoicing call carries that token as a bearer.
// Tokens are cached in module scope for the life of the function instance —
// worth doing because a warm Vercel instance handles many requests, and PayPal
// rate-limits the token endpoint far more aggressively than the data plane.
//
// Sandbox and live are separate hosts *and* separate credential sets. Pointing
// live credentials at the sandbox host returns 401, so PAYPAL_API_BASE and the
// client id must come from the same PayPal app.
const DEFAULT_API_BASE = "https://api-m.sandbox.paypal.com";

function apiBase(): string {
  return (process.env.PAYPAL_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

function clientId(): string {
  const id = process.env.PAYPAL_CLIENT_ID;
  if (!id) {
    throw new HttpError(500, "misconfigured", "PAYPAL_CLIENT_ID is not set");
  }
  return id;
}

function clientSecret(): string {
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!secret) {
    throw new HttpError(500, "misconfigured", "PAYPAL_CLIENT_SECRET is not set");
  }
  return secret;
}

export type PayPalAddress = {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_2?: string;
  admin_area_1?: string;
  postal_code?: string;
  country_code: string;
};

export type PayPalInvoicer = {
  name: { given_name: string; surname: string };
  email_address?: string;
  address: PayPalAddress;
};

export type PayPalRecipient = {
  email: string;
  given_name?: string;
  surname?: string;
};

export type PayPalItem = {
  name: string;
  description?: string;
  quantity: string;
  unit_amount: { currency_code: string; value: string };
};

export type PayPalInvoice = {
  id: string;
  status: string | null;
  invoice_number: string | null;
  currency_code: string | null;
  amount: string | null;
  due_date: string | null;
  payer_view_url: string | null;
  recipient_email: string | null;
};

/**
 * The invoicing merchant — the "invoicer" on every invoice this gateway
 * creates. PayPal requires a name and country on the account issuing the
 * invoice, and rejects an invoicer whose PayPal account is not in good
 * standing, so this is configuration rather than per-request input.
 */
function invoicer(): PayPalInvoicer {
  const given = process.env.PAYPAL_MERCHANT_GIVEN_NAME;
  const surname = process.env.PAYPAL_MERCHANT_SURNAME;
  const country = process.env.PAYPAL_MERCHANT_COUNTRY_CODE ?? "US";
  if (!given || !surname) {
    throw new HttpError(
      500,
      "misconfigured",
      "PAYPAL_MERCHANT_GIVEN_NAME and PAYPAL_MERCHANT_SURNAME are not set",
    );
  }
  const line1 = process.env.PAYPAL_MERCHANT_ADDRESS_LINE_1;
  return {
    name: { given_name: given, surname },
    ...(process.env.PAYPAL_MERCHANT_EMAIL
      ? { email_address: process.env.PAYPAL_MERCHANT_EMAIL }
      : {}),
    address: {
      ...(line1 ? { address_line_1: line1 } : {}),
      ...(process.env.PAYPAL_MERCHANT_CITY
        ? { admin_area_2: process.env.PAYPAL_MERCHANT_CITY }
        : {}),
      ...(process.env.PAYPAL_MERCHANT_STATE
        ? { admin_area_1: process.env.PAYPAL_MERCHANT_STATE }
        : {}),
      ...(process.env.PAYPAL_MERCHANT_POSTAL_CODE
        ? { postal_code: process.env.PAYPAL_MERCHANT_POSTAL_CODE }
        : {}),
      country_code: country,
    },
  };
}

export function currencyCode(): string {
  return process.env.PAYPAL_CURRENCY_CODE ?? "USD";
}

async function parseBody(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/**
 * PayPal error bodies are `{ name, message, details: [{ issue, description }],
 * debug_id }` on the data plane and `{ error, error_description }` on the
 * token endpoint.
 *
 * Status mapping follows the same principle as _lib/nylas.ts: only statuses
 * the caller can act on pass through. A 401/403 means *our* client credentials
 * are wrong or the app lacks the invoicing scope — a server misconfiguration
 * the caller cannot fix — so it collapses to 502 rather than leaking an auth
 * failure. 404, 422 and 429 are actionable and pass through: a 422 from PayPal
 * is a genuine problem with the invoice we built from the caller's row (bad
 * amount, malformed email), and the caller is the one who can correct it.
 *
 * `debug_id` is always appended when present — it is the only handle PayPal
 * support will accept when a call fails for reasons the response does not
 * explain.
 */
function raiseFor(resp: Response, parsed: Record<string, unknown>): never {
  const name = String(parsed.name ?? parsed.error ?? `http_${resp.status}`);
  const base = String(
    parsed.message ?? parsed.error_description ?? `PayPal returned ${resp.status}`,
  );
  const details = Array.isArray(parsed.details)
    ? (parsed.details as Record<string, unknown>[])
        .map((d) => `${d.issue ?? "issue"}: ${d.description ?? ""}`.trim())
        .filter(Boolean)
    : [];
  const suffix = [
    details.length ? ` (${details.join("; ")})` : "",
    parsed.debug_id ? ` [debug_id: ${String(parsed.debug_id)}]` : "",
  ].join("");
  const status =
    resp.status === 404 || resp.status === 422 || resp.status === 429 ? resp.status : 502;
  throw new HttpError(status, `paypal_${name.toLowerCase()}`, `${base}${suffix}`);
}

type CachedToken = { token: string; expiresAt: number };

let cachedToken: CachedToken | null = null;

/**
 * Fetches — or reuses — a client_credentials access token.
 *
 * The cache expires 60s early so a token cannot go stale mid-flight between
 * the create and send calls of a two-step invoice. This endpoint authenticates
 * with HTTP Basic (client id as user, secret as password) and takes a
 * form-encoded body, unlike every other call in this module.
 */
async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
  } catch (err) {
    throw new HttpError(
      502,
      "provider_unreachable",
      err instanceof Error ? err.message : String(err),
    );
  }
  const parsed = await parseBody(resp);
  if (!resp.ok) raiseFor(resp, parsed);
  const token = parsed.access_token;
  if (typeof token !== "string" || !token) {
    throw new HttpError(502, "paypal_no_token", "token exchange returned no access_token");
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 300;
  cachedToken = { token, expiresAt: now + Math.max(expiresIn - 60, 30) * 1000 };
  return token;
}

async function request(
  method: string,
  path: string,
  opts: { body?: unknown; requestId?: string } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // PayPal-Request-Id is PayPal's idempotency key: a replayed create returns
  // the original invoice instead of minting a duplicate. Callers derive it
  // from the local row id so a retried request is genuinely the same request.
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  // Without this, create returns only { id, links } and the caller has to make
  // a second round trip to learn the invoice's status and amount.
  if (method === "POST") headers["Prefer"] = "return=representation";

  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err) {
    // Network-level failure: PayPal never saw the request.
    throw new HttpError(
      502,
      "provider_unreachable",
      err instanceof Error ? err.message : String(err),
    );
  }
  const parsed = await parseBody(resp);
  if (!resp.ok) raiseFor(resp, parsed);
  return parsed;
}

function str(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function linkHref(parsed: Record<string, unknown>, rel: string): string | null {
  const links = Array.isArray(parsed.links) ? (parsed.links as Record<string, unknown>[]) : [];
  const match = links.find((l) => String(l.rel ?? "") === rel);
  return match ? str(match.href) : null;
}

function asInvoice(raw: Record<string, unknown>): PayPalInvoice {
  const detail = (raw.detail ?? {}) as Record<string, unknown>;
  const amount = (raw.amount ?? {}) as Record<string, unknown>;
  const recipients = Array.isArray(raw.primary_recipients)
    ? (raw.primary_recipients as Record<string, unknown>[])
    : [];
  const billingInfo = (recipients[0]?.billing_info ?? {}) as Record<string, unknown>;
  const paymentTerm = (detail.payment_term ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id),
    status: str(raw.status),
    invoice_number: str(detail.invoice_number),
    currency_code: str(detail.currency_code) ?? str(amount.currency_code),
    amount: str(amount.value),
    due_date: str(paymentTerm.due_date),
    // Present on the send response as `payer-view`; on a read it is the
    // recipient-facing link under the same rel.
    payer_view_url: linkHref(raw, "payer-view"),
    recipient_email: str(billingInfo.email_address),
  };
}

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

export type CreateInvoiceOpts = {
  invoiceNumber: string;
  invoiceDate: string;
  recipient: PayPalRecipient;
  items: PayPalItem[];
  currency?: string;
  note?: string;
  reference?: string;
  dueDate?: string;
  /** Idempotency key; derive it from the local row so retries collapse. */
  requestId: string;
};

/**
 * Creates a DRAFT invoice. Nothing reaches the patient until sendInvoice()
 * runs — the two-step shape is PayPal's, not ours.
 */
export async function createDraftInvoice(opts: CreateInvoiceOpts): Promise<PayPalInvoice> {
  if (opts.items.length === 0) {
    throw new HttpError(422, "no_items", "a PayPal invoice needs at least one line item");
  }
  const currency = opts.currency ?? currencyCode();
  const parsed = await request("POST", "/v2/invoicing/invoices", {
    requestId: opts.requestId,
    body: {
      detail: {
        invoice_number: opts.invoiceNumber,
        invoice_date: opts.invoiceDate,
        currency_code: currency,
        ...(opts.note ? { note: opts.note } : {}),
        ...(opts.reference ? { reference: opts.reference } : {}),
        ...(opts.dueDate
          ? { payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: opts.dueDate } }
          : {}),
      },
      invoicer: invoicer(),
      primary_recipients: [
        {
          billing_info: {
            email_address: opts.recipient.email,
            ...(opts.recipient.given_name || opts.recipient.surname
              ? {
                  name: {
                    ...(opts.recipient.given_name
                      ? { given_name: opts.recipient.given_name }
                      : {}),
                    ...(opts.recipient.surname ? { surname: opts.recipient.surname } : {}),
                  },
                }
              : {}),
          },
        },
      ],
      items: opts.items,
    },
  });
  return asInvoice(parsed);
}

export type SendInvoiceOpts = {
  subject?: string;
  note?: string;
  additionalRecipients?: string[];
  /** Defaults to true — an invoice nobody is told about is not an invoice. */
  sendToRecipient?: boolean;
  /** Defaults to false: the merchant does not need a copy of every patient bill. */
  sendToInvoicer?: boolean;
  requestId: string;
};

/**
 * Sends (or, when the invoice date is in the future, schedules) a draft
 * invoice. Returns the payer-view URL from the 202 body when PayPal supplies
 * one — a scheduled send returns no link, which is why this is nullable.
 */
export async function sendInvoice(
  invoiceId: string,
  opts: SendInvoiceOpts,
): Promise<{ payer_view_url: string | null }> {
  const parsed = await request(
    "POST",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    {
      requestId: opts.requestId,
      body: {
        send_to_recipient: opts.sendToRecipient !== false,
        send_to_invoicer: opts.sendToInvoicer === true,
        ...(opts.subject ? { subject: opts.subject } : {}),
        ...(opts.note ? { note: opts.note } : {}),
        ...(opts.additionalRecipients?.length
          ? { additional_recipients: opts.additionalRecipients }
          : {}),
      },
    },
  );
  // The 202 body is `{ href, rel: "payer-view", method: "GET" }` — a bare
  // object, not the links array a read returns.
  return { payer_view_url: str(parsed.href) ?? linkHref(parsed, "payer-view") };
}

export async function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
  const parsed = await request(
    "GET",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
  );
  return asInvoice(parsed);
}
