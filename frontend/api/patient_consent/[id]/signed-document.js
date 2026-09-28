import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { getEnvelope, getEnvelopeDocumentPdf } from "../../_lib/docusign.js";
/**
 * Downloads the executed consent form as a PDF.
 *
 * Defaults to DocuSign's "combined" pseudo-document — every document on the
 * envelope plus the certificate of completion in one file. The certificate is
 * the part that matters for a consent: it carries the signer's identity, IP,
 * timestamps and disclosure acceptance, and without it the PDF is just a
 * picture of a signature.
 *
 * Unlike its siblings this responds with binary, so it does not go through
 * sendError's JSON shape on success.
 */
async function handler(req, res) {
    try {
        requireApiKey(req);
        if (req.method !== "GET") {
            throw new HttpError(405, "method_not_allowed", "only GET is supported");
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
        // Read the envelope first rather than trusting the cached status on the
        // row: a download of a half-signed consent would hand the caller a
        // document that looks executed but is not.
        const envelope = await getEnvelope(String(envelopeId), { includeRecipients: false });
        const status = (envelope.status ?? "").toLowerCase();
        if (status !== "completed") {
            throw new HttpError(409, "not_complete", `envelope ${envelopeId} is "${status || "unknown"}", not "completed"; there is no signed document yet`);
        }
        const documentId = typeof req.query.document_id === "string" ? req.query.document_id : "combined";
        const { content, contentType } = await getEnvelopeDocumentPdf(String(envelopeId), documentId, {
            certificate: true,
        });
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", String(content.length));
        res.setHeader("Content-Disposition", `attachment; filename="consent-${id}-${envelopeId}.pdf"`);
        // Signed consents are PHI. Nothing between here and the caller should keep
        // a copy.
        res.setHeader("Cache-Control", "no-store, private");
        res.status(200).send(content);
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
