import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow } from "../../_lib/rows.js";
import { createDraftInvoice, currencyCode, getInvoice, sendInvoice, } from "../../_lib/paypal.js";
// An invoice that is already settled, written off, or voided must not be
// re-billed. Everything else — the DB column default "active", the seeded
// "pending" — is fair game.
const UNSENDABLE = new Set(["paid", "partially_paid", "void", "voided", "cancelled", "written_off"]);
const DEFAULT_DUE_DAYS = 30;
/**
 * The payment state of an invoicing row.
 *
 * Two statuses exist per row and they disagree: every table in this schema has
 * a typed `status` column that defaults to "active" and receives whatever the
 * generic "Create X" request sends, while the seeded billing rows carry the
 * domain-specific state ("pending", "paid") inside `data`. mergeRow() spreads
 * `data` first, so the column shadows the jsonb value and a paid invoice reads
 * as "active". Billing is the wrong place to lose that distinction, so this
 * prefers the jsonb value when one is present.
 */
function paymentState(row, data) {
    return String(data.status ?? row.status ?? "").toLowerCase();
}
/** PayPal takes amounts as decimal strings, not numbers. */
function money(value, label) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw new HttpError(422, "bad_amount", `invoicing '${label}' must be a positive number`);
    }
    return n.toFixed(2);
}
function isoDate(d) {
    return d.toISOString().slice(0, 10);
}
async function loadPatient(sb, id) {
    if (id === undefined || id === null || id === "") {
        throw new HttpError(422, "fk_missing", "invoicing row has no 'patient_id'");
    }
    const { data, error } = await sb.from("patients").select("*").eq("id", Number(id)).maybeSingle();
    if (error)
        throw new HttpError(500, "db_error", error.message);
    if (!data) {
        throw new HttpError(422, "fk_not_found", `patient_id=${id} does not exist in patients`);
    }
    return mergeRow(data);
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
            .from("invoicing")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (error)
            throw new HttpError(500, "db_error", error.message);
        if (!raw)
            throw new HttpError(404, "not_found", `no invoicing row with id ${id}`);
        const existingData = (raw.data ?? {});
        const invoice = mergeRow(raw);
        const state = paymentState(invoice, existingData);
        if (UNSENDABLE.has(state)) {
            throw new HttpError(409, "not_sendable", `cannot send an invoice with status "${state}"`);
        }
        // Idempotency: a retried send must not bill the patient twice. If the row
        // already points at a PayPal invoice, read it back instead of creating a
        // second one. PayPal-Request-Id would collapse a replayed *create*, but it
        // does not protect a create issued after the pointer was persisted.
        if (existingData.paypal_invoice_id) {
            const existing = await getInvoice(String(existingData.paypal_invoice_id));
            res.status(200).json({
                ...mergeRow(raw),
                invoice_sent: false,
                paypal_invoice: existing,
            });
            return;
        }
        const patient = await loadPatient(sb, invoice.patient_id);
        const patientEmail = String(patient.email ?? "").trim();
        if (!patientEmail) {
            throw new HttpError(422, "no_email", "patient has no email on file to invoice");
        }
        const amount = money(invoice.amount, "amount");
        const currency = String(body.currency ?? invoice.currency ?? currencyCode());
        // PHI: the invoice leaves our BAA boundary — PayPal will not sign one —
        // and the row's `description` is the clinical reason for the visit
        // ("Cardiology consult"). The line item therefore carries a generic label
        // by default, matching the stance appointments/[id]/invite.ts takes on
        // calendar event titles. A caller that has cleared the disclosure can pass
        // `include_description: true` or supply its own `item_name`.
        const itemName = String(body.item_name ?? "Medical services");
        const includeDescription = body.include_description === true;
        const description = String(invoice.description ?? "").trim();
        const now = new Date();
        const dueDays = Number(body.due_days ?? DEFAULT_DUE_DAYS);
        if (!Number.isFinite(dueDays) || dueDays < 0) {
            throw new HttpError(400, "bad_due_days", "'due_days' must be a non-negative number");
        }
        const dueDate = new Date(now.getTime() + dueDays * 86400 * 1000);
        const draft = await createDraftInvoice({
            // Derived from the row id, so it is stable across retries and traceable
            // back to this gateway from the PayPal dashboard.
            invoiceNumber: `HCO-${id}`,
            invoiceDate: isoDate(now),
            dueDate: isoDate(dueDate),
            currency,
            recipient: {
                email: patientEmail,
                given_name: String(patient.first_name ?? "") || undefined,
                surname: String(patient.last_name ?? "") || undefined,
            },
            items: [
                {
                    name: itemName,
                    ...(includeDescription && description ? { description } : {}),
                    quantity: "1",
                    unit_amount: { currency_code: currency, value: amount },
                },
            ],
            note: body.note === undefined ? undefined : String(body.note),
            reference: `invoicing/${id}`,
            requestId: `hco-invoicing-${id}-create`,
        });
        const sent = await sendInvoice(draft.id, {
            subject: body.subject === undefined ? undefined : String(body.subject),
            note: body.note === undefined ? undefined : String(body.note),
            additionalRecipients: Array.isArray(body.additional_recipients)
                ? body.additional_recipients.map(String)
                : undefined,
            sendToRecipient: body.send_to_recipient !== false,
            sendToInvoicer: body.send_to_invoicer === true,
            requestId: `hco-invoicing-${id}-send`,
        });
        const sentAt = new Date().toISOString();
        const { data: updated, error: updateErr } = await sb
            .from("invoicing")
            .update({
            status: "sent",
            // Spread first: a partial write would clobber the rest of the jsonb.
            data: {
                ...existingData,
                status: "sent",
                paypal_invoice_id: draft.id,
                paypal_invoice_number: draft.invoice_number,
                paypal_payer_view_url: sent.payer_view_url ?? draft.payer_view_url,
                currency,
                due_date: isoDate(dueDate),
                sent_at: sentAt,
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
                kind: "invoice_sent",
                provider: "paypal",
                invoicing_id: id,
                patient_id: patient.id,
                paypal_invoice_id: draft.id,
                amount,
                currency,
                // The recipient address is the one fact an operator needs to answer
                // "where did this bill go?" without reopening the patient record.
                recipient_email: patientEmail,
                sent_at: sentAt,
            },
        });
        if (notifErr)
            throw new HttpError(500, "db_error", notifErr.message);
        res.status(200).json({
            ...mergeRow(updated),
            invoice_sent: true,
            paypal_invoice: {
                ...draft,
                payer_view_url: sent.payer_view_url ?? draft.payer_view_url,
            },
        });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
