import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { listCalendars, listEvents, toEpochSeconds } from "../_lib/nylas.js";
import { requireGrant } from "../_lib/nylasGrants.js";
const MAX_LIMIT = 200;
/**
 * Reads a clinician's connected calendar.
 *
 * With no `calendar_id` this lists the calendars themselves; with one it lists
 * that calendar's events. The two live behind one route because the caller
 * always needs the first to make sense of the second.
 */
async function handler(req, res) {
    try {
        requireApiKey(req);
        if (req.method !== "GET") {
            throw new HttpError(405, "method_not_allowed", "only GET is supported");
        }
        const sb = serverClient();
        const grant = await requireGrant(sb, req.query.provider_id);
        const calendarId = String(req.query.calendar_id ?? "").trim();
        if (!calendarId) {
            const calendars = await listCalendars(grant.grant_id);
            res.status(200).json({
                provider_id: grant.provider_id,
                mailbox: grant.email,
                count: calendars.length,
                calendars,
            });
            return;
        }
        const limitRaw = req.query.limit;
        const limit = limitRaw === undefined ? 50 : Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            throw new HttpError(400, "bad_limit", `'limit' must be an integer 1–${MAX_LIMIT}`);
        }
        const page = await listEvents(grant.grant_id, {
            calendarId,
            limit,
            pageToken: req.query.page_token ? String(req.query.page_token) : undefined,
            start: req.query.start ? toEpochSeconds(req.query.start, "'start'") : undefined,
            end: req.query.end ? toEpochSeconds(req.query.end, "'end'") : undefined,
            title: req.query.title ? String(req.query.title) : undefined,
            // Cancelled events are excluded unless asked for: a cancelled entry still
            // occupies a row in the provider's calendar but is not a real commitment.
            showCancelled: String(req.query.show_cancelled ?? "") === "true",
            // Recurring series are expanded into concrete instances, otherwise a
            // weekly clinic renders as a single event at its first occurrence.
            expandRecurring: String(req.query.expand_recurring ?? "true") !== "false",
        });
        res.status(200).json({
            provider_id: grant.provider_id,
            calendar_id: calendarId,
            count: page.items.length,
            next_cursor: page.next_cursor,
            events: page.items,
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
