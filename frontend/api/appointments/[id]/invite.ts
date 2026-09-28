import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";
import { createEvent, getEvent, toEpochSeconds, type NylasEvent } from "../../_lib/nylas.js";
import { requireGrant } from "../../_lib/nylasGrants.js";

// Only a live, not-yet-attended appointment is worth putting on a calendar.
// "checked-in" is excluded deliberately: the patient is already in the building.
const INVITABLE = new Set(["active", "scheduled"]);

const CONFERENCING = new Set(["Google Meet", "Microsoft Teams"]);

const DEFAULT_DURATION_MIN = 30;

function clinicTimezone(): string {
  return process.env.CLINIC_TIMEZONE ?? "America/New_York";
}

async function loadRow(
  sb: ReturnType<typeof serverClient>,
  table: string,
  id: unknown,
  label: string,
): Promise<Record<string, unknown>> {
  if (id === undefined || id === null || id === "") {
    throw new HttpError(422, "fk_missing", `appointment has no '${label}'`);
  }
  const { data, error } = await sb.from(table).select("*").eq("id", Number(id)).maybeSingle();
  if (error) throw new HttpError(500, "db_error", error.message);
  if (!data) throw new HttpError(422, "fk_not_found", `${label}=${id} does not exist in ${table}`);
  return mergeRow(data as Row) as Record<string, unknown>;
}

function providerName(provider: Record<string, unknown>): string | null {
  const full = `${provider.first_name ?? ""} ${provider.last_name ?? ""}`.trim();
  return full || null;
}

/**
 * Default event title.
 *
 * Carries the patient's first name and last initial rather than their full
 * name: the title propagates to the clinician's calendar, which may be shared
 * with front-desk staff or exposed at detail level through free/busy. The
 * visit reason is never included by default: it is PHI, and the calendar event
 * leaves our BAA boundary. A caller that has cleared the disclosure can pass
 * `title` and `description` explicitly.
 */
function defaultTitle(patient: Record<string, unknown>): string {
  const first = String(patient.first_name ?? "").trim();
  const lastInitial = String(patient.last_name ?? "").trim().charAt(0);
  const who = [first, lastInitial ? `${lastInitial}.` : ""].filter(Boolean).join(" ");
  return who ? `Appointment — ${who}` : "Appointment";
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "bad_id", "id must be numeric");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const sb = serverClient();
    const { data: raw, error } = await sb
      .from("appointments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new HttpError(500, "db_error", error.message);
    if (!raw) throw new HttpError(404, "not_found", `no appointment with id ${id}`);
    const existingData = ((raw as Row).data ?? {}) as Record<string, unknown>;
    const appt = mergeRow(raw as Row) as Record<string, unknown>;

    const status = String(appt.status ?? "");
    if (!INVITABLE.has(status)) {
      throw new HttpError(
        409,
        "not_invitable",
        `cannot send a calendar invite for an appointment with status "${status}"`,
      );
    }

    const patient = await loadRow(sb, "patients", appt.patient_id, "patient_id");
    const provider = await loadRow(sb, "providers", appt.provider_id, "provider_id");
    const grant = await requireGrant(sb, provider.id);

    // Orbit's brief for the v3 event read confirms the literal "primary" is
    // accepted, so no calendar lookup is needed for the common case.
    const calendarId = String(body.calendar_id ?? existingData.nylas_calendar_id ?? "primary");

    // Idempotency: a retried invite must not double-book the clinician. If the
    // row already points at an event, read it back instead of creating another.
    if (existingData.nylas_event_id) {
      const existing = await getEvent(
        grant.grant_id,
        String(existingData.nylas_event_id),
        calendarId,
      );
      res.status(200).json({
        ...(mergeRow(raw as Row) as Record<string, unknown>),
        event_created: false,
        event: existing,
      });
      return;
    }

    const startTime = toEpochSeconds(appt.starts_at, "appointment 'starts_at'");
    const durationMin = Number(appt.duration_min ?? DEFAULT_DURATION_MIN);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      throw new HttpError(422, "bad_duration", `appointment 'duration_min' must be positive`);
    }
    const endTime = startTime + Math.round(durationMin * 60);

    const patientEmail = String(patient.email ?? "").trim();
    if (!patientEmail) {
      throw new HttpError(422, "no_email", "patient has no email on file to invite");
    }

    const conferencing = body.conferencing === undefined ? undefined : String(body.conferencing);
    if (conferencing !== undefined && !CONFERENCING.has(conferencing)) {
      throw new HttpError(
        400,
        "bad_conferencing",
        `'conferencing' must be one of: ${[...CONFERENCING].join(", ")}`,
      );
    }

    const event: NylasEvent = await createEvent(grant.grant_id, {
      calendarId,
      title: String(body.title ?? defaultTitle(patient)),
      description: body.description === undefined ? undefined : String(body.description),
      location: body.location === undefined ? undefined : String(body.location),
      startTime,
      endTime,
      timezone: String(body.timezone ?? clinicTimezone()),
      participants: [
        {
          email: patientEmail,
          name: `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim() || undefined,
        },
      ],
      conferencing: conferencing as "Google Meet" | "Microsoft Teams" | undefined,
      // Nylas metadata values must be strings; these let an event found in the
      // provider's calendar be traced back to the row that created it.
      metadata: {
        local_appointment_id: String(id),
        local_patient_id: String(patient.id),
        source: "healthcare-org-gateway",
      },
      notifyParticipants: body.notify_participants !== false,
    });

    const invitedAt = new Date().toISOString();
    const { data: updated, error: updateErr } = await sb
      .from("appointments")
      .update({
        // Spread first: a partial write would clobber the rest of the jsonb.
        data: {
          ...existingData,
          nylas_event_id: event.id,
          nylas_calendar_id: event.calendar_id ?? calendarId,
          nylas_grant_id: grant.grant_id,
          nylas_event_link: event.html_link,
          conferencing_url: event.conferencing_url,
          invited_at: invitedAt,
        },
        updated_at: invitedAt,
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) throw new HttpError(500, "db_error", updateErr.message);

    const { error: notifErr } = await sb.from("notifications").insert({
      status: "sent",
      data: {
        kind: "appointment_invite_sent",
        provider: "nylas",
        appointment_id: id,
        patient_id: patient.id,
        provider_id: provider.id,
        clinician: providerName(provider),
        nylas_event_id: event.id,
        calendar_id: event.calendar_id ?? calendarId,
        starts_at: event.start,
        ends_at: event.end,
        sent_at: invitedAt,
      },
    });
    if (notifErr) throw new HttpError(500, "db_error", notifErr.message);

    res.status(200).json({
      ...(mergeRow(updated as Row) as Record<string, unknown>),
      event_created: true,
      event,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
