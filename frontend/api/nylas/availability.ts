import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_lib/supabase.js";
import { requireApiKey } from "../_lib/auth.js";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { getAvailability, getFreeBusy, toEpochSeconds } from "../_lib/nylas.js";
import { requireGrant } from "../_lib/nylasGrants.js";

// A search window wider than this makes Nylas fan out across every
// participant's provider and routinely times out behind a serverless function.
const MAX_WINDOW_DAYS = 31;

/**
 * Finds when a set of clinicians can actually meet.
 *
 * Two modes, because they answer different questions:
 *   mode=slots    (default) → bookable openings of `duration_minutes`
 *   mode=freebusy           → raw busy blocks per person, no event detail
 *
 * `freebusy` is the privacy-preserving read — it returns no titles, locations,
 * or descriptions — and is grant-scoped, so it also requires that every address
 * sit on the same upstream provider. `slots` is application-scoped and only
 * returns availability for addresses already connected to this Nylas app.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const sb = serverClient();
    // The grant is required even in `slots` mode: it is how we verify the
    // caller owns at least one of the calendars being inspected, rather than
    // letting anyone with the gateway key probe arbitrary mailboxes.
    const grant = await requireGrant(sb, body.provider_id);

    const startTime = toEpochSeconds(body.start, "'start'");
    const endTime = toEpochSeconds(body.end, "'end'");
    if (endTime <= startTime) {
      throw new HttpError(422, "bad_window", "'end' must be after 'start'");
    }
    if (endTime - startTime > MAX_WINDOW_DAYS * 86400) {
      throw new HttpError(422, "window_too_wide", `search window cannot exceed ${MAX_WINDOW_DAYS} days`);
    }

    const emails = Array.isArray(body.emails)
      ? body.emails.map((e) => String(e).trim()).filter(Boolean)
      : [];
    // Default to the connected clinician alone — the common case is "when is
    // Dr. X free", not a multi-party huddle.
    const participants = emails.length > 0 ? emails : grant.email ? [grant.email] : [];
    if (participants.length === 0) {
      throw new HttpError(422, "no_participants", "'emails' is required — the grant has no address");
    }

    const mode = String(body.mode ?? "slots");
    if (mode === "freebusy") {
      const busy = await getFreeBusy(grant.grant_id, { startTime, endTime, emails: participants });
      res.status(200).json({
        provider_id: grant.provider_id,
        mode,
        window: { start: body.start, end: body.end },
        free_busy: busy,
      });
      return;
    }
    if (mode !== "slots") {
      throw new HttpError(400, "bad_mode", "'mode' must be 'slots' or 'freebusy'");
    }

    const durationMinutes = Number(body.duration_minutes ?? 30);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      throw new HttpError(400, "bad_duration", "'duration_minutes' must be an integer 5–480");
    }
    const intervalRaw = body.interval_minutes;
    const intervalMinutes = intervalRaw === undefined ? durationMinutes : Number(intervalRaw);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5) {
      throw new HttpError(400, "bad_interval", "'interval_minutes' must be an integer ≥ 5");
    }

    const slots = await getAvailability({
      startTime,
      endTime,
      durationMinutes,
      intervalMinutes,
      participants: participants.map((email) => ({ email })),
    });

    res.status(200).json({
      provider_id: grant.provider_id,
      mode,
      window: { start: body.start, end: body.end },
      duration_minutes: durationMinutes,
      count: slots.length,
      slots,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
