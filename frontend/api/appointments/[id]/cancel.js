import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow } from "../../_lib/rows.js";
import { assertTransition } from "../../_lib/businessRules.js";
import { cancelEvent } from "../../_lib/nylas.js";
import { requireGrant } from "../../_lib/nylasGrants.js";
/**
 * Withdraws the calendar invite created by /invite, if there is one.
 *
 * Best-effort by design: a Nylas outage must not prevent a clinic from
 * cancelling an appointment locally. The failure is reported rather than
 * thrown, and the row keeps `nylas_event_id` so the stale invite can be
 * chased down instead of being silently forgotten.
 */
async function withdrawInvite(sb, appt, notifyParticipants) {
    const eventId = appt.nylas_event_id ? String(appt.nylas_event_id) : null;
    if (!eventId)
        return { status: "none", event_id: null };
    try {
        const grant = await requireGrant(sb, appt.provider_id);
        await cancelEvent(grant.grant_id, eventId, String(appt.nylas_calendar_id ?? "primary"), notifyParticipants);
        return { status: "cancelled", event_id: eventId };
    }
    catch (err) {
        // An event already deleted upstream 404s; that is the desired end state,
        // not a failure to report.
        if (err instanceof HttpError && err.status === 404) {
            return { status: "cancelled", event_id: eventId };
        }
        if (err instanceof HttpError) {
            return { status: "failed", event_id: eventId, code: err.code, message: err.message };
        }
        throw err;
    }
}
async function handler(req, res) {
    try {
        requireApiKey(req);
        if (req.method !== "POST") {
            throw new HttpError(405, "method_not_allowed", "only POST is supported");
        }
        const id = Number(req.query.id);
        if (!Number.isFinite(id))
            throw new HttpError(400, "bad_id", "id must be numeric");
        const body = (req.body ?? {});
        const sb = serverClient();
        const { data: raw, error: readErr } = await sb
            .from("appointments")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (readErr)
            throw new HttpError(500, "db_error", readErr.message);
        if (!raw)
            throw new HttpError(404, "not_found", `no appointment with id ${id}`);
        const existingData = (raw.data ?? {});
        const appt = mergeRow(raw);
        assertTransition("appointments", appt.status, "cancelled");
        const calendar = await withdrawInvite(sb, appt, body.notify_participants !== false);
        const cancelledAt = new Date().toISOString();
        const { data, error } = await sb
            .from("appointments")
            .update({
            status: "cancelled",
            data: {
                ...existingData,
                cancelled_at: cancelledAt,
                // Only clear the event pointer once the invite is genuinely gone.
                // Dropping it on failure would orphan a live calendar entry.
                ...(calendar.status === "cancelled"
                    ? { nylas_event_id: null, nylas_event_link: null, conferencing_url: null }
                    : {}),
                ...(calendar.status === "failed"
                    ? { nylas_cancel_error: `${calendar.code}: ${calendar.message}` }
                    : {}),
            },
            updated_at: cancelledAt,
        })
            .eq("id", id)
            .select()
            .single();
        if (error)
            throw new HttpError(400, "db_error", error.message);
        if (calendar.status !== "none") {
            const { error: notifErr } = await sb.from("notifications").insert({
                status: calendar.status === "cancelled" ? "sent" : "failed",
                data: {
                    kind: "appointment_invite_cancelled",
                    provider: "nylas",
                    appointment_id: id,
                    nylas_event_id: calendar.event_id,
                    outcome: calendar.status,
                    ...(calendar.code ? { error_code: calendar.code, error_message: calendar.message } : {}),
                    cancelled_at: cancelledAt,
                },
            });
            if (notifErr)
                throw new HttpError(500, "db_error", notifErr.message);
        }
        // 207 when the appointment is cancelled locally but its invite is still
        // sitting on the clinician's calendar, so callers can tell a full success
        // from a partial one.
        res.status(calendar.status === "failed" ? 207 : 200).json({
            ...mergeRow(data),
            calendar_invite: calendar,
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
