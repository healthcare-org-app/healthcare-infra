import { createSign } from "node:crypto";
import { HttpError } from "./errors.js";

// DocuSign eSignature REST v2.1.
//
// Auth is the awkward part and Orbit's brief does not cover it: the briefs say
// "Authorization: Bearer <accessToken>" and leave acquiring that token to the
// caller. There is no static API key. For a server-to-server integration with
// no human at a browser, the only workable grant is JWT Grant: we sign a short
// assertion with an RSA key registered against the integration key, and
// DocuSign exchanges it for a ~1h access token that impersonates a service
// user. That is what this module implements.
//
// Two hosts, and they are not the same axis as sandbox/live credentials:
//   - the *account* host issues tokens and answers /oauth/userinfo
//     (account-d.docusign.com for demo, account.docusign.com for production)
//   - the *API* host serves /restapi and is per-account, discovered from
//     userinfo (e.g. https://demo.docusign.net, https://na4.docusign.net)
// Hard-coding the API host is the usual cause of a 401 that looks like a bad
// key: a production account reached at demo.docusign.net rejects a valid token.
// So DOCUSIGN_API_BASE is optional and we resolve it from userinfo by default.

const DEFAULT_OAUTH_BASE = "https://account-d.docusign.com";

// JWT Grant tokens are capped at 1h by DocuSign regardless of what we ask for.
const ASSERTION_LIFETIME_SEC = 3600;

const SCOPES = "signature impersonation";

function oauthBase(): string {
  return (process.env.DOCUSIGN_OAUTH_BASE ?? DEFAULT_OAUTH_BASE).replace(/\/+$/, "");
}

function integrationKey(): string {
  const key = process.env.DOCUSIGN_INTEGRATION_KEY;
  if (!key) {
    throw new HttpError(500, "misconfigured", "DOCUSIGN_INTEGRATION_KEY is not set");
  }
  return key;
}

function impersonatedUserId(): string {
  const sub = process.env.DOCUSIGN_USER_ID;
  if (!sub) {
    throw new HttpError(500, "misconfigured", "DOCUSIGN_USER_ID is not set");
  }
  return sub;
}

/**
 * The RSA private key paired with the integration key's public key.
 *
 * Vercel environment variables cannot hold literal newlines, so the PEM is
 * normally stored with "\n" escapes. Both forms are accepted.
 */
function privateKey(): string {
  const raw = process.env.DOCUSIGN_PRIVATE_KEY;
  if (!raw) {
    throw new HttpError(500, "misconfigured", "DOCUSIGN_PRIVATE_KEY is not set");
  }
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** Optional default template for consent forms, overridable per request. */
export function defaultTemplateId(): string | null {
  return process.env.DOCUSIGN_CONSENT_TEMPLATE_ID || null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Builds the RS256 JWT assertion DocuSign exchanges for an access token.
 *
 * `aud` is the account host *without* a scheme — DocuSign rejects the
 * assertion outright if the scheme is included, with an error that does not
 * say so.
 */
function assertion(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: integrationKey(),
      sub: impersonatedUserId(),
      aud: oauthBase().replace(/^https?:\/\//, ""),
      iat: now,
      exp: now + ASSERTION_LIFETIME_SEC,
      scope: SCOPES,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  let signature: Buffer;
  try {
    signature = signer.sign(privateKey());
  } catch (err) {
    // A malformed PEM fails here, before any network call. Surfacing it as a
    // config error rather than a generic 500 saves a lot of guessing.
    throw new HttpError(
      500,
      "misconfigured",
      `DOCUSIGN_PRIVATE_KEY is not a usable RSA private key: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return `${header}.${payload}.${b64url(signature)}`;
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
 * Turns a DocuSign error body into an HttpError.
 *
 * Data-plane errors are `{ errorCode, message }`; OAuth errors are
 * `{ error, error_description }`.
 *
 * Status mapping follows _lib/paypal.ts: only statuses the caller can act on
 * pass through. 401/403 means *our* JWT grant is wrong or unconsented — a
 * server misconfiguration the caller cannot fix — so it collapses to 502.
 * DocuSign returns 400 for a payload it dislikes, and that payload is built
 * from the caller's row (missing signer email, bad template role), so 400 maps
 * to 422 where the caller can see what to correct.
 */
function raiseFor(resp: Response, parsed: Record<string, unknown>): never {
  const code = String(parsed.errorCode ?? parsed.error ?? `http_${resp.status}`);
  const message = String(
    parsed.message ?? parsed.error_description ?? parsed.raw ?? `DocuSign returned ${resp.status}`,
  );
  // The one auth failure an operator must be told about verbatim: JWT Grant
  // fails until the impersonated user has granted consent once, and the fix is
  // a URL nobody remembers how to build.
  if (code === "consent_required") {
    throw new HttpError(
      500,
      "docusign_consent_required",
      `the DocuSign user has not granted impersonation consent. Visit ${oauthBase()}` +
        `/oauth/auth?response_type=code&scope=${encodeURIComponent(SCOPES)}` +
        `&client_id=${encodeURIComponent(integrationKey())}` +
        `&redirect_uri=<a redirect URI registered on the integration key>` +
        ` while signed in as that user, then retry.`,
    );
  }
  const status = resp.status === 400 ? 422 : resp.status === 404 || resp.status === 429 ? resp.status : 502;
  throw new HttpError(status, `docusign_${code.toLowerCase()}`, message);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Fetches — or reuses — a JWT Grant access token.
 *
 * Cached in module scope for the life of the function instance: a warm Vercel
 * instance handles many requests and DocuSign rate-limits the token endpoint
 * far more aggressively than the data plane. Expires 60s early so a token
 * cannot go stale mid-flight between the create and status calls of one
 * request.
 */
async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

  let resp: Response;
  try {
    resp = await fetch(`${oauthBase()}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion(),
      }).toString(),
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
    throw new HttpError(502, "docusign_no_token", "JWT grant returned no access_token");
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  cachedToken = { token, expiresAt: now + Math.max(expiresIn - 60, 30) * 1000 };
  return token;
}

let cachedAccount: { accountId: string; apiBase: string } | null = null;

/**
 * Resolves the account id and the per-account API host.
 *
 * Both can be pinned with env vars to skip the userinfo round trip; unset, we
 * ask DocuSign. `base_uri` from userinfo is an origin (https://na4.docusign.net)
 * and the REST root is that plus /restapi.
 */
async function account(): Promise<{ accountId: string; apiBase: string }> {
  const pinnedId = process.env.DOCUSIGN_ACCOUNT_ID;
  const pinnedBase = process.env.DOCUSIGN_API_BASE;
  if (pinnedId && pinnedBase) {
    return { accountId: pinnedId, apiBase: pinnedBase.replace(/\/+$/, "") };
  }
  if (cachedAccount) return cachedAccount;

  let resp: Response;
  try {
    resp = await fetch(`${oauthBase()}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${await accessToken()}`, Accept: "application/json" },
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

  const accounts = Array.isArray(parsed.accounts)
    ? (parsed.accounts as Array<Record<string, unknown>>)
    : [];
  const match = pinnedId
    ? accounts.find((a) => String(a.account_id) === pinnedId)
    : accounts.find((a) => a.is_default === true) ?? accounts[0];
  if (!match) {
    throw new HttpError(
      502,
      "docusign_no_account",
      pinnedId
        ? `DOCUSIGN_ACCOUNT_ID=${pinnedId} is not among the accounts this user can access`
        : "the DocuSign user has no accessible accounts",
    );
  }
  const baseUri = String(match.base_uri ?? "").replace(/\/+$/, "");
  if (!baseUri) {
    throw new HttpError(502, "docusign_no_base_uri", "userinfo returned an account with no base_uri");
  }
  cachedAccount = {
    accountId: String(match.account_id),
    apiBase: pinnedBase ? pinnedBase.replace(/\/+$/, "") : `${baseUri}/restapi`,
  };
  return cachedAccount;
}

/** The account-scoped REST prefix every call below hangs off. */
async function accountPath(): Promise<string> {
  const { accountId, apiBase } = await account();
  return `${apiBase}/v2.1/accounts/${encodeURIComponent(accountId)}`;
}

async function request(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    Accept: "application/json",
  };
  // Orbit's brief flags that the collection's create request carries a raw
  // JSON body with no Content-Type. DocuSign silently misreads it without one.
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const url = new URL(`${await accountPath()}${path}`);
  // Omit unset options rather than sending empty values: the brief warns the
  // collection's placeholders have no defaults and DocuSign treats an empty
  // `include=` as a malformed filter, not an absent one.
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err) {
    // Network-level failure: DocuSign never saw the request.
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

export type DocuSignSigner = {
  email: string;
  name: string;
  /** Stable per-envelope handle. Defaults to "1" for the single-signer case. */
  recipientId?: string;
  /** Template role to bind this signer to, when sending from a template. */
  roleName?: string;
  routingOrder?: string;
  /**
   * Where the signature block lands in an inline document. DocuSign anchors on
   * a literal string in the PDF text; a document that does not contain it gets
   * no signature tab and the signer has nothing to click.
   */
  anchorString?: string;
};

export type DocuSignDocument = {
  /** Envelope-local id. Defaults to its 1-based position. */
  documentId?: string;
  name: string;
  fileExtension?: string;
  /** Base64-encoded file content. */
  documentBase64: string;
};

export type DocuSignEnvelope = {
  envelope_id: string;
  status: string | null;
  status_changed_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  uri: string | null;
  recipients: DocuSignRecipient[];
};

export type DocuSignRecipient = {
  recipient_id: string | null;
  name: string | null;
  email: string | null;
  status: string | null;
  signed_at: string | null;
  declined_reason: string | null;
};

function asRecipients(raw: Record<string, unknown> | undefined): DocuSignRecipient[] {
  const signers = Array.isArray(raw?.signers) ? (raw.signers as Array<Record<string, unknown>>) : [];
  return signers.map((s) => ({
    recipient_id: str(s.recipientId),
    name: str(s.name),
    email: str(s.email),
    status: str(s.status),
    signed_at: str(s.signedDateTime),
    declined_reason: str(s.declinedReason),
  }));
}

function asEnvelope(raw: Record<string, unknown>): DocuSignEnvelope {
  return {
    envelope_id: String(raw.envelopeId),
    status: str(raw.status),
    status_changed_at: str(raw.statusDateTime),
    sent_at: str(raw.sentDateTime),
    completed_at: str(raw.completedDateTime),
    uri: str(raw.uri),
    recipients: asRecipients(raw.recipients as Record<string, unknown> | undefined),
  };
}

/**
 * Creates an envelope and, unless `draft` is set, sends it.
 *
 * Two mutually exclusive shapes, mirroring DocuSign's own API:
 *   - `templateId` + signers bound by `roleName` — the practice authors the
 *     consent form once in DocuSign and we fill in the patient. Preferred.
 *   - inline `documents` + signers with an `anchorString` — for one-off PDFs
 *     the practice has not templated.
 *
 * The create response carries only envelopeId/status/uri; recipient ids are
 * not returned, which is why `recipients` comes back empty here. Call
 * getEnvelope() with recipients included to learn them.
 */
export async function createEnvelope(opts: {
  emailSubject: string;
  emailBlurb?: string;
  signers: DocuSignSigner[];
  templateId?: string | null;
  documents?: DocuSignDocument[];
  /** Save without sending. DocuSign's own default is to send. */
  draft?: boolean;
  /** Echoed back on reads and webhooks; use it to trace an envelope to a row. */
  customFields?: Record<string, string>;
}): Promise<DocuSignEnvelope> {
  if (opts.signers.length === 0) {
    throw new HttpError(422, "no_signers", "a DocuSign envelope needs at least one signer");
  }
  const usingTemplate = Boolean(opts.templateId);
  if (!usingTemplate && !opts.documents?.length) {
    throw new HttpError(
      422,
      "no_document",
      "provide either a DocuSign 'template_id' or an inline document to send for signature",
    );
  }

  const status = opts.draft ? "created" : "sent";

  const body: Record<string, unknown> = {
    emailSubject: opts.emailSubject,
    ...(opts.emailBlurb ? { emailBlurb: opts.emailBlurb } : {}),
    status,
    ...(opts.customFields && Object.keys(opts.customFields).length
      ? {
          customFields: {
            textCustomFields: Object.entries(opts.customFields).map(([name, value]) => ({
              name,
              value,
              show: "false",
            })),
          },
        }
      : {}),
  };

  if (usingTemplate) {
    body.templateId = opts.templateId;
    body.templateRoles = opts.signers.map((s, i) => ({
      email: s.email,
      name: s.name,
      roleName: s.roleName ?? "Signer 1",
      routingOrder: s.routingOrder ?? String(i + 1),
    }));
  } else {
    body.documents = (opts.documents ?? []).map((d, i) => ({
      documentId: d.documentId ?? String(i + 1),
      name: d.name,
      fileExtension: d.fileExtension ?? "pdf",
      documentBase64: d.documentBase64,
    }));
    body.recipients = {
      signers: opts.signers.map((s, i) => {
        const anchor = s.anchorString;
        return {
          email: s.email,
          name: s.name,
          recipientId: s.recipientId ?? String(i + 1),
          routingOrder: s.routingOrder ?? String(i + 1),
          ...(anchor
            ? {
                tabs: {
                  signHereTabs: [
                    { anchorString: anchor, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "0" },
                  ],
                },
              }
            : {}),
        };
      }),
    };
  }

  const parsed = await request("POST", "/envelopes", { body });
  if (!parsed.envelopeId) {
    throw new HttpError(502, "docusign_no_envelope_id", "envelope creation returned no envelopeId");
  }
  return asEnvelope(parsed);
}

/**
 * Reads an envelope's overall status.
 *
 * Recipients are requested by default: without `include=recipients` the
 * response has no recipient ids, and the disclosure endpoint needs one.
 */
export async function getEnvelope(
  envelopeId: string,
  opts: { includeRecipients?: boolean } = {},
): Promise<DocuSignEnvelope> {
  const include = opts.includeRecipients === false ? undefined : "recipients";
  const parsed = await request("GET", `/envelopes/${encodeURIComponent(envelopeId)}`, {
    query: { include },
  });
  return asEnvelope(parsed);
}

export type DocuSignEnvelopeDocument = {
  document_id: string | null;
  name: string | null;
  type: string | null;
  uri: string | null;
};

/** Lists the documents on an envelope, including the "certificate" pseudo-document. */
export async function listEnvelopeDocuments(
  envelopeId: string,
): Promise<DocuSignEnvelopeDocument[]> {
  const parsed = await request("GET", `/envelopes/${encodeURIComponent(envelopeId)}/documents`);
  const docs = Array.isArray(parsed.envelopeDocuments)
    ? (parsed.envelopeDocuments as Array<Record<string, unknown>>)
    : [];
  return docs.map((d) => ({
    document_id: str(d.documentId),
    name: str(d.name),
    type: str(d.type),
    uri: str(d.uri),
  }));
}

/**
 * Downloads one document as a PDF.
 *
 * `documentId` accepts the literal "combined" for every document plus the
 * certificate of completion in a single PDF — which is the artefact worth
 * retaining for a signed consent, since the certificate is the audit trail
 * that makes the signature defensible.
 *
 * This is the one call that does not return JSON, so it bypasses request().
 */
export async function getEnvelopeDocumentPdf(
  envelopeId: string,
  documentId = "combined",
  opts: { certificate?: boolean } = {},
): Promise<{ content: Buffer; contentType: string }> {
  const url = new URL(
    `${await accountPath()}/envelopes/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}`,
  );
  if (opts.certificate !== undefined) {
    url.searchParams.set("certificate", String(opts.certificate));
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}`, Accept: "application/pdf" },
    });
  } catch (err) {
    throw new HttpError(
      502,
      "provider_unreachable",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!resp.ok) raiseFor(resp, await parseBody(resp));
  return {
    content: Buffer.from(await resp.arrayBuffer()),
    contentType: resp.headers.get("content-type") ?? "application/pdf",
  };
}

/**
 * Retrieves the HTML Electronic Record and Signature Disclosure shown to a
 * signer.
 *
 * Worth surfacing rather than ignoring: ESIGN/UETA make the signature
 * enforceable only if the signer was given this disclosure and consented to do
 * business electronically, and the per-recipient copy reflects the branding
 * and language actually applied to *their* envelope, which can differ from the
 * account default.
 *
 * Returns HTML, not JSON — DocuSign wraps it in a JSON envelope on this route,
 * so the HTML arrives under `consumerDisclosure` fields rather than as a body.
 */
export async function getConsumerDisclosure(
  envelopeId: string,
  recipientId: string,
  langCode?: string,
): Promise<Record<string, unknown>> {
  return request(
    "GET",
    `/envelopes/${encodeURIComponent(envelopeId)}/recipients/${encodeURIComponent(recipientId)}/consumer_disclosure`,
    { query: { langCode } },
  );
}

/** Envelope statuses that mean the signing process is over, one way or another. */
export const TERMINAL_STATUSES = new Set(["completed", "declined", "voided"]);
