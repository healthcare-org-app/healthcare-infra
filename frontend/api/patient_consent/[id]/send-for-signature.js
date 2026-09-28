import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow } from "../../_lib/rows.js";
import { createEnvelope, defaultTemplateId, getEnvelope, } from "../../_lib/docusign.js";
// A consent that is already executed or withdrawn must not be re-sent. Anything
// else — the column default "active", a seeded "pending" or "draft" — is fair
// game.
const UNSENDABLE = new Set(["signed", "completed", "executed", "revoked", "withdrawn", "expired"]);
// DocuSign anchors a signature block on a literal string in the PDF's text
// layer. This is the convention DocuSign's own samples use; a one-off PDF that
// does not contain it would reach the patient with nothing to click, so an
// inline send may override it.
const DEFAULT_ANCHOR = "/sig1/";
/**
 * The lifecycle state of a consent row.
 *
 * Same split as _lib/../invoicing/[id]/send.ts: every table has a typed
 * `status` column defaulting to "active", while seeded rows carry the
 * domain-specific state inside `data`. mergeRow() lets the column shadow the
 * jsonb value, which would read an already-signed consent as "active" — not a
 * distinction to lose on a consent form.
 */
function consentState(row, data) {
    return String(data.status ?? row.status ?? "").toLowerCase();
}
async function loadPatient(sb, id) {
    if (id === undefined || id === null || id === "") {
        throw new HttpError(422, "fk_missing", "patient_consent row has no 'patient_id'");
    }
    const { data, error } = await sb.from("patients").select("*").eq("id", Number(id)).maybeSingle();
    if (error)
        throw new HttpError(500, "db_error", error.message);
    if (!data) {
        throw new HttpError(422, "fk_not_found", `patient_id=${id} does not exist in patients`);
    }
    return mergeRow(data);
}
function patientName(patient) {
    const full = `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim();
    if (!full) {
        throw new HttpError(422, "no_name", "patient has no name on file; DocuSign requires a signer name");
    }
    return full;
}
/**
 * The inline document, when the caller is not sending from a template.
 *
 * Kept deliberately narrow: the caller passes base64 rather than a URL so the
 * gateway never fetches an arbitrary remote document on the practice's behalf.
 */
function inlineDocument(body) {
    const base64 = body.document_base64;
    if (base64 === undefined || base64 === null || base64 === "")
        return undefined;
    if (typeof base64 !== "string") {
        throw new HttpError(400, "bad_document", "'document_base64' must be a base64-encoded string");
    }
    return [
        {
            documentId: "1",
            name: String(body.document_name ?? "Consent form"),
            fileExtension: String(body.document_extension ?? "pdf"),
            documentBase64: base64,
        },
    ];
}
/** Human-readable label for the consent, used in the signing email subject. */
function consentLabel(consent) {
    const label = consent.consent_type ?? consent.type ?? consent.name ?? consent.title;
    const text = String(label ?? "").trim();
    return text || "Consent form";
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
        const consent = mergeRow(raw);
        const state = consentState(consent, existingData);
        if (UNSENDABLE.has(state)) {
            throw new HttpError(409, "not_sendable", `cannot send a consent with status "${state}" for signature`);
        }
        // Idempotency: a retried send must not put a second consent form in the
        // patient's inbox. If the row already points at an envelope, read it back.
        if (existingData.docusign_envelope_id) {
            const existing = await getEnvelope(String(existingData.docusign_envelope_id));
            res.status(200).json({
                ...mergeRow(raw),
                envelope_created: false,
                envelope: existing,
            });
            return;
        }
        const patient = await loadPatient(sb, consent.patient_id);
        const email = String(patient.email ?? "").trim();
        if (!email) {
            throw new HttpError(422, "no_email", "patient has no email on file to send a consent form to");
        }
        const templateId = body.template_id === undefined
            ? existingData.docusign_template_id ?? defaultTemplateId()
            : body.template_id === null
                ? null
                : String(body.template_id);
        const documents = inlineDocument(body);
        if (!templateId && !documents) {
            throw new HttpError(422, "no_document", "no consent document to send: pass 'template_id' or 'document_base64', " +
                "or set DOCUSIGN_CONSENT_TEMPLATE_ID");
        }
        const label = consentLabel(consent);
        const envelope = await createEnvelope({
            emailSubject: String(body.email_subject ?? `Please sign: ${label}`),
            emailBlurb: body.email_message === undefined ? undefined : String(body.email_message),
            templateId,
            documents,
            draft: body.draft === true,
            signers: [
                {
                    email,
                    name: patientName(patient),
                    recipientId: "1",
                    roleName: String(body.role_name ?? "Signer 1"),
                    anchorString: templateId ? undefined : String(body.sign_here_anchor ?? DEFAULT_ANCHOR),
                },
            ],
            // Lets an envelope found in the DocuSign console be traced back to the
            // row that created it. DocuSign custom field values must be strings.
            customFields: {
                local_patient_consent_id: String(id),
                local_patient_id: String(patient.id),
                source: "healthcare-org-gateway",
            },
        });
        const sentAt = new Date().toISOString();
        const { data: updated, error: updateErr } = await sb
            .from("patient_consent")
            .update({
            // Spread first: a partial write would clobber the rest of the jsonb.
            data: {
                ...existingData,
                docusign_envelope_id: envelope.envelope_id,
                docusign_envelope_status: envelope.status,
                ...(templateId ? { docusign_template_id: templateId } : {}),
                signature_requested_at: sentAt,
            },
            updated_at: sentAt,
        })
            .eq("id", id)
            .select()
            .single();
        if (updateErr)
            throw new HttpError(500, "db_error", updateErr.message);
        const { error: notifErr } = await sb.from("notifications").insert({
            status: "sent",
            data: {
                kind: "consent_signature_requested",
                provider: "docusign",
                patient_consent_id: id,
                patient_id: patient.id,
                consent_type: label,
                // The recipient email is already on the patient row; repeating it here
                // would spread PHI into a second table for no operational gain.
                docusign_envelope_id: envelope.envelope_id,
                envelope_status: envelope.status,
                sent_at: sentAt,
            },
        });
        if (notifErr)
            throw new HttpError(500, "db_error", notifErr.message);
        res.status(200).json({
            ...mergeRow(updated),
            envelope_created: true,
            envelope,
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
