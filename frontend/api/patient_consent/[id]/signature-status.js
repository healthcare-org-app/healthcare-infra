import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow } from "../../_lib/rows.js";
import { getConsumerDisclosure, getEnvelope, listEnvelopeDocuments, TERMINAL_STATUSES, } from "../../_lib/docusign.js";
// DocuSign envelope status → the consent lifecycle state we record locally.
// Only terminal statuses map: while an envelope is "sent" or "delivered" the
// consent is still outstanding and the row's own status should not move.
const LOCAL_STATUS = {
    completed: "signed",
    declined: "declined",
    voided: "voided",
};
function isTrue(value) {
    return value === true || value === "true" || value === "1";
}
/**
 * Mirrors the envelope's terminal outcome onto the consent row.
 *
 * Only writes when something actually changed — this endpoint is designed to
 * be polled, and a no-op poll should not churn `updated_at` or make every read
 * look like an edit in the audit log.
 */
async function persist(sb, id, existingData, envelope) {
    const local = envelope.status ? LOCAL_STATUS[envelope.status.toLowerCase()] : undefined;
    const statusUnchanged = existingData.docusign_envelope_status === envelope.status;
    if (statusUnchanged && !local)
        return null;
    const signer = envelope.recipients[0];
    const now = new Date().toISOString();
    const patch = {
        ...existingData,
        docusign_envelope_status: envelope.status,
        ...(envelope.completed_at ? { signed_at: envelope.completed_at } : {}),
        ...(signer?.signed_at ? { signer_signed_at: signer.signed_at } : {}),
        ...(signer?.declined_reason ? { declined_reason: signer.declined_reason } : {}),
    };
    const { data, error } = await sb
        .from("patient_consent")
        .update({
        data: patch,
        // The typed column carries the lifecycle state the rest of the app reads,
        // so a completed envelope has to land there too — not just in the jsonb.
        ...(local ? { status: local } : {}),
        updated_at: now,
    })
        .eq("id", id)
        .select()
        .single();
    if (error)
        throw new HttpError(500, "db_error", error.message);
    return data;
}
async function handler(req, res) {
    try {
        requireApiKey(req);
        if (req.method !== "GET" && req.method !== "POST") {
            throw new HttpError(405, "method_not_allowed", "only GET and POST are supported");
        }
        const id = Number(req.query.id);
        if (!Number.isFinite(id))
            throw new HttpError(400, "bad_id", "id must be numeric");
        const sb = serverClient();
        const { data: raw, error } = await sb
            .from("patient_consent")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (error)
            throw new HttpError(500, "db_error", error.message);
        if (!raw)
            throw new HttpError(404, "not_found", `no patient_consent with id ${id}`);
        const existingData = (raw.data ?? {});
        const envelopeId = existingData.docusign_envelope_id;
        if (!envelopeId) {
            throw new HttpError(409, "not_sent", `patient_consent ${id} has not been sent for signature yet`);
        }
        const envelope = await getEnvelope(String(envelopeId));
        const updated = await persist(sb, id, existingData, envelope);
        const row = mergeRow((updated ?? raw));
        const terminal = envelope.status ? TERMINAL_STATUSES.has(envelope.status.toLowerCase()) : false;
        // Only listed once the envelope is finished: mid-flight the list is just
        // the unsigned originals, which is a misleading thing to hand a caller
        // asking about a signature.
        const documents = terminal && isTrue(req.query.include_documents)
            ? await listEnvelopeDocuments(String(envelopeId))
            : undefined;
        // The disclosure the signer was actually shown. Opt-in because it is a
        // sizeable HTML blob, but it is the record that makes the e-signature
        // defensible under ESIGN/UETA, so it is worth being able to pull on demand.
        const signerRecipientId = envelope.recipients[0]?.recipient_id;
        const disclosure = isTrue(req.query.include_disclosure) && signerRecipientId
            ? await getConsumerDisclosure(String(envelopeId), signerRecipientId, typeof req.query.lang_code === "string" ? req.query.lang_code : undefined)
            : undefined;
        res.status(200).json({
            ...row,
            envelope,
            complete: terminal,
            ...(documents ? { documents } : {}),
            ...(disclosure ? { consumer_disclosure: disclosure } : {}),
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
