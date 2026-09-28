import { HttpError } from "./errors.js";
// Nylas v3. One API key authenticates the *application*; every mailbox and
// calendar call is then scoped to a `grant_id` — the per-user connection minted
// by the hosted OAuth flow when a provider links their Google or Microsoft
// account. This module only speaks HTTP; grant persistence lives in
// nylasGrants.ts.
//
// Region matters: a Nylas application is provisioned in either US or EU and the
// two data planes are separate. Calling the wrong host returns 401, not a
// redirect, so NYLAS_API_URI must match the dashboard region.
const DEFAULT_API_URI = "https://api.us.nylas.com";
function apiUri() {
    return (process.env.NYLAS_API_URI ?? DEFAULT_API_URI).replace(/\/+$/, "");
}
function apiKey() {
    const key = process.env.NYLAS_API_KEY;
    if (!key) {
        throw new HttpError(500, "misconfigured", "NYLAS_API_KEY is not set");
    }
    return key;
}
function clientId() {
    const id = process.env.NYLAS_CLIENT_ID;
    if (!id) {
        throw new HttpError(500, "misconfigured", "NYLAS_CLIENT_ID is not set");
    }
    return id;
}
function callbackUri() {
    const uri = process.env.NYLAS_CALLBACK_URI;
    if (!uri) {
        throw new HttpError(500, "misconfigured", "NYLAS_CALLBACK_URI is not set");
    }
    return uri;
}
function buildUrl(path, query = {}) {
    const url = new URL(`${apiUri()}${path}`);
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined)
            continue;
        url.searchParams.set(k, String(v));
    }
    return url.toString();
}
async function parseBody(resp) {
    const text = await resp.text();
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
/**
 * Nylas error bodies are `{ request_id, error: { type, message, provider_error } }`.
 *
 * Status mapping follows one principle: only statuses the
 * caller can act on pass through. A plain 401/403 means *our* API key or scopes
 * are wrong — a server misconfiguration, not a bad request from the caller — so
 * it collapses to 502 rather than leaking an auth failure the caller cannot fix.
 * 404 and 429 are actionable and pass through unchanged.
 *
 * A grant-level auth failure is the exception. It looks like a 401 but means
 * something entirely different: the clinician revoked access provider-side, or
 * changed their password, and the fix is to reconnect the mailbox. Reporting
 * that as 502 would send an operator hunting a gateway fault that isn't there,
 * so it surfaces as 409 — the same status requireGrant() uses for a connection
 * we already know is dead.
 */
function raiseFor(resp, parsed) {
    const e = (parsed.error ?? {});
    const type = String(e.type ?? `http_${resp.status}`);
    const providerError = e.provider_error ? ` (provider: ${JSON.stringify(e.provider_error)})` : "";
    const rawMessage = String(e.message ?? `Nylas returned ${resp.status}`);
    const isGrantFailure = (resp.status === 401 || resp.status === 403) && /grant/i.test(`${type} ${rawMessage}`);
    if (isGrantFailure) {
        throw new HttpError(409, "nylas_grant_invalid", `${rawMessage}${providerError} — the clinician must reconnect their mailbox`);
    }
    const status = resp.status === 404 || resp.status === 429 ? resp.status : 502;
    throw new HttpError(status, `nylas_${type}`, `${rawMessage}${providerError}`);
}
async function request(method, path, opts = {}) {
    const headers = {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
    };
    if (opts.body !== undefined)
        headers["Content-Type"] = "application/json";
    let resp;
    try {
        resp = await fetch(buildUrl(path, opts.query), {
            method,
            headers,
            ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        });
    }
    catch (err) {
        // Network-level failure: Nylas never saw the request.
        throw new HttpError(502, "provider_unreachable", err instanceof Error ? err.message : String(err));
    }
    const parsed = await parseBody(resp);
    if (!resp.ok)
        raiseFor(resp, parsed);
    return parsed;
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function str(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return String(value);
}
/** Nylas timestamps are Unix seconds; the rest of this codebase speaks ISO-8601. */
function fromEpoch(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return null;
    return new Date(value * 1000).toISOString();
}
export function toEpochSeconds(value, label) {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) {
        throw new HttpError(422, "bad_timestamp", `${label} "${String(value)}" is not a parsable date`);
    }
    return Math.floor(d.getTime() / 1000);
}
function asParticipants(value) {
    return asArray(value).map((p) => ({
        email: String(p.email ?? ""),
        name: str(p.name),
        status: str(p.status),
    }));
}
function asMessage(raw) {
    return {
        id: String(raw.id),
        thread_id: str(raw.thread_id),
        subject: str(raw.subject),
        from: asParticipants(raw.from),
        to: asParticipants(raw.to),
        date: fromEpoch(raw.date),
        unread: raw.unread === true,
        starred: raw.starred === true,
        has_attachments: asArray(raw.attachments).length > 0,
        folders: Array.isArray(raw.folders) ? raw.folders : [],
    };
}
function asCalendar(raw) {
    return {
        id: String(raw.id),
        name: str(raw.name),
        description: str(raw.description),
        timezone: str(raw.timezone),
        is_primary: raw.is_primary === true,
        read_only: raw.read_only === true,
    };
}
function asEvent(raw) {
    // `when` is polymorphic: a timespan carries start_time/end_time, an all-day
    // datespan carries start_date/end_date, and it can be null outright for
    // virtual-calendar events. Anything unrecognised degrades to null rather than
    // producing an Invalid Date.
    const when = (raw.when ?? {});
    const conferencing = (raw.conferencing ?? {});
    const details = (conferencing.details ?? {});
    return {
        id: String(raw.id),
        calendar_id: str(raw.calendar_id),
        title: str(raw.title),
        description: str(raw.description),
        location: str(raw.location),
        status: str(raw.status),
        // Nylas documents `busy` as nullable; absent means the slot blocks time.
        busy: raw.busy !== false,
        start: fromEpoch(when.start_time) ?? str(when.start_date),
        end: fromEpoch(when.end_time) ?? str(when.end_date),
        participants: asParticipants(raw.participants),
        conferencing_url: str(details.url),
        html_link: str(raw.html_link),
    };
}
function cursor(parsed) {
    return str(parsed.next_cursor);
}
// ---------------------------------------------------------------------------
// Hosted OAuth
// ---------------------------------------------------------------------------
/**
 * Builds the URL a provider is sent to in order to link their mailbox. The
 * `state` round-trips back to the callback and is what binds the returned code
 * to the local provider row that started the flow — see nylasGrants.ts.
 */
export function hostedAuthUrl(opts) {
    return buildUrl("/v3/connect/auth", {
        client_id: clientId(),
        redirect_uri: callbackUri(),
        response_type: "code",
        // Without offline access the grant stops working when the provider's
        // upstream token expires, which for Google is one hour.
        access_type: "offline",
        state: opts.state,
        login_hint: opts.loginHint,
        provider: opts.provider,
    });
}
/**
 * Exchanges a single-use authorization code for a durable grant.
 *
 * This endpoint authenticates with client_id/client_secret in the body rather
 * than a bearer header — in v3 the API key doubles as the client secret.
 */
export async function exchangeCodeForGrant(code) {
    let resp;
    try {
        resp = await fetch(buildUrl("/v3/connect/token"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                client_id: clientId(),
                client_secret: apiKey(),
                redirect_uri: callbackUri(),
                code,
                grant_type: "authorization_code",
            }),
        });
    }
    catch (err) {
        throw new HttpError(502, "provider_unreachable", err instanceof Error ? err.message : String(err));
    }
    const parsed = await parseBody(resp);
    if (!resp.ok)
        raiseFor(resp, parsed);
    if (!parsed.grant_id) {
        throw new HttpError(502, "nylas_no_grant", "token exchange succeeded but returned no grant_id");
    }
    const scope = parsed.scope;
    return {
        grant_id: String(parsed.grant_id),
        email: str(parsed.email),
        provider: str(parsed.provider),
        scope: typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [],
    };
}
/** Revokes a grant upstream. Idempotent: an already-deleted grant 404s, which is fine. */
export async function revokeGrant(grantId) {
    try {
        await request("DELETE", `/v3/grants/${encodeURIComponent(grantId)}`);
    }
    catch (err) {
        if (err instanceof HttpError && err.status === 404)
            return;
        throw err;
    }
}
// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export async function listMessages(grantId, opts = {}) {
    const parsed = await request("GET", `/v3/grants/${encodeURIComponent(grantId)}/messages`, {
        query: {
            limit: opts.limit,
            page_token: opts.pageToken,
            unread: opts.unread,
            from: opts.from,
            subject: opts.subject,
            in: opts.in,
            search_query_native: opts.searchQueryNative,
        },
    });
    return { items: asArray(parsed.data).map(asMessage), next_cursor: cursor(parsed) };
}
export async function getMessage(grantId, messageId) {
    const parsed = await request("GET", `/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}`);
    const raw = (parsed.data ?? {});
    return {
        ...asMessage(raw),
        body: str(raw.body),
        cc: asParticipants(raw.cc),
        // Attachment *metadata* only. Downloading content is a separate endpoint
        // and a separate decision — clinical attachments are the densest PHI in a
        // mailbox and should not ride along with a message read.
        attachments: asArray(raw.attachments).map((a) => ({
            id: String(a.id),
            filename: str(a.filename),
            content_type: str(a.content_type),
            size: typeof a.size === "number" ? a.size : null,
        })),
    };
}
export async function sendMessage(grantId, opts) {
    const headers = {};
    if (opts.idempotencyKey)
        headers["Idempotency-Key"] = opts.idempotencyKey;
    // Send is the one call that carries an Idempotency-Key, so it bypasses the
    // shared request() helper's fixed header set.
    let resp;
    try {
        resp = await fetch(buildUrl(`/v3/grants/${encodeURIComponent(grantId)}/messages/send`), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey()}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                ...headers,
            },
            body: JSON.stringify({
                to: opts.to.map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}) })),
                subject: opts.subject,
                body: opts.body,
                ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
            }),
        });
    }
    catch (err) {
        throw new HttpError(502, "provider_unreachable", err instanceof Error ? err.message : String(err));
    }
    const parsed = await parseBody(resp);
    if (!resp.ok)
        raiseFor(resp, parsed);
    const data = (parsed.data ?? {});
    return { id: str(data.id), thread_id: str(data.thread_id) };
}
// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export async function listCalendars(grantId) {
    const parsed = await request("GET", `/v3/grants/${encodeURIComponent(grantId)}/calendars`);
    return asArray(parsed.data).map(asCalendar);
}
export async function listEvents(grantId, opts) {
    const parsed = await request("GET", `/v3/grants/${encodeURIComponent(grantId)}/events`, {
        query: {
            calendar_id: opts.calendarId,
            limit: opts.limit,
            page_token: opts.pageToken,
            start: opts.start,
            end: opts.end,
            title: opts.title,
            show_cancelled: opts.showCancelled,
            expand_recurring: opts.expandRecurring,
        },
    });
    return { items: asArray(parsed.data).map(asEvent), next_cursor: cursor(parsed) };
}
export async function getEvent(grantId, eventId, calendarId) {
    const parsed = await request("GET", `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(eventId)}`, { query: { calendar_id: calendarId } });
    return asEvent((parsed.data ?? {}));
}
export async function createEvent(grantId, opts) {
    if (opts.endTime <= opts.startTime) {
        throw new HttpError(422, "bad_timespan", "event end must be after its start");
    }
    const parsed = await request("POST", `/v3/grants/${encodeURIComponent(grantId)}/events`, {
        query: {
            calendar_id: opts.calendarId,
            // Defaults to true: an appointment the patient is never told about is
            // worse than no calendar entry at all.
            notify_participants: opts.notifyParticipants !== false,
        },
        body: {
            title: opts.title,
            description: opts.description,
            location: opts.location,
            when: {
                start_time: opts.startTime,
                end_time: opts.endTime,
                ...(opts.timezone ? { start_timezone: opts.timezone, end_timezone: opts.timezone } : {}),
            },
            busy: true,
            ...(opts.participants
                ? {
                    participants: opts.participants.map((p) => ({
                        email: p.email,
                        ...(p.name ? { name: p.name } : {}),
                    })),
                }
                : {}),
            ...(opts.conferencing
                ? { conferencing: { provider: opts.conferencing, autocreate: {} } }
                : {}),
            ...(opts.metadata ? { metadata: opts.metadata } : {}),
        },
    });
    return asEvent((parsed.data ?? {}));
}
export async function cancelEvent(grantId, eventId, calendarId, notifyParticipants = true) {
    await request("DELETE", `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(eventId)}`, { query: { calendar_id: calendarId, notify_participants: notifyParticipants } });
}
/**
 * A per-address free/busy failure arrives either as a bare string or as an
 * `{ type, message }` object depending on where it originated. Stringifying the
 * object form blindly would surface "[object Object]" to the caller.
 */
function asFreeBusyError(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value === "object") {
        const e = value;
        return str(e.message) ?? str(e.type) ?? JSON.stringify(e);
    }
    return String(value);
}
/**
 * Returns the busy blocks for a set of addresses, without exposing event
 * titles, descriptions, or locations — the privacy-preserving read, and the
 * right one to use when the caller only needs to know *whether* a clinician is
 * free. `getAvailability` below answers the different question of which slots
 * are bookable.
 *
 * Two constraints from the Nylas docs: the grant must be authorized to see the
 * requested addresses' free/busy data (a provider-side setting), and every
 * address must be on the same provider. Mixed Google/Microsoft lists fail.
 * Per-address failures come back inline as error objects rather than as a
 * request-level error, so a single unreadable calendar does not sink the batch.
 */
export async function getFreeBusy(grantId, opts) {
    if (opts.emails.length === 0) {
        throw new HttpError(422, "no_emails", "free/busy needs at least one email");
    }
    const parsed = await request("POST", `/v3/grants/${encodeURIComponent(grantId)}/calendars/free-busy`, { body: { start_time: opts.startTime, end_time: opts.endTime, emails: opts.emails } });
    return asArray(parsed.data).map((entry) => ({
        email: String(entry.email ?? ""),
        busy: asArray(entry.time_slots).map((slot) => ({
            start: fromEpoch(slot.start_time) ?? "",
            end: fromEpoch(slot.end_time) ?? "",
        })),
        error: asFreeBusyError(entry.error),
    }));
}
/**
 * Finds slots where every participant is free. This call is application-scoped
 * rather than grant-scoped, but each participant email must belong to a grant
 * in the same Nylas application — an unconnected email yields no availability
 * rather than an error, so callers should verify the grant exists first.
 */
export async function getAvailability(opts) {
    if (opts.participants.length === 0) {
        throw new HttpError(422, "no_participants", "availability needs at least one participant");
    }
    const parsed = await request("POST", "/v3/calendars/availability", {
        body: {
            start_time: opts.startTime,
            end_time: opts.endTime,
            duration_minutes: opts.durationMinutes,
            interval_minutes: opts.intervalMinutes ?? opts.durationMinutes,
            ...(opts.roundTo !== undefined ? { round_to: opts.roundTo } : {}),
            participants: opts.participants.map((p) => ({
                email: p.email,
                calendar_ids: p.calendarIds ?? ["primary"],
            })),
        },
    });
    const data = (parsed.data ?? {});
    return asArray(data.time_slots).map((slot) => ({
        start: fromEpoch(slot.start_time) ?? "",
        end: fromEpoch(slot.end_time) ?? "",
        emails: Array.isArray(slot.emails) ? slot.emails : [],
    }));
}
