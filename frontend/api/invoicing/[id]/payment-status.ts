import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../_lib/supabase.js";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { mergeRow, type Row } from "../../_lib/rows.js";
import { getInvoiceWithPayments, type PayPalPayment } from "../../_lib/paypal.js";

// PayPal invoice status → the payment state recorded locally. Only outcomes
// that change what the clinic can do with the row are mapped: while an invoice
// is SENT, UNPAID or PAYMENT_PENDING the row's own status should not move.
// The local names match the UNSENDABLE set in ./send.ts.
const LOCAL_STATUS: Record<string, string> = {
  PAID: "paid",
  MARKED_AS_PAID: "paid",
  PARTIALLY_PAID: "partially_paid",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  MARKED_AS_REFUNDED: "refunded",
};

const TERMINAL = new Set(["paid", "cancelled", "refunded"]);

// Postgres unique_violation: another poll recorded the same PayPal payment
// between our existence check and our insert, which is the outcome we want.
const UNIQUE_VIOLATION = "23505";

type Sb = ReturnType<typeof serverClient>;

/**
 * Inserts one `payments` row per PayPal transaction not already recorded.
 *
 * Keyed on the PayPal payment id, so repeated polls are no-ops and a part-paid
 * invoice yields one row per instalment. Returns how many rows were new.
 */
async function recordPayments(
  sb: Sb,
  ctx: {
    invoicingId: number;
    patientId: unknown;
    paypalInvoiceId: string;
    fallbackCurrency: string | null;
  },
  payments: PayPalPayment[],
): Promise<number> {
  let recorded = 0;
  for (const p of payments) {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount)) continue;

    const { data: existing, error: readErr } = await sb
      .from("payments")
      .select("id")
      .contains("data", { paypal_payment_id: p.payment_id })
      .limit(1);
    if (readErr) throw new HttpError(500, "db_error", readErr.message);
    if ((existing ?? []).length > 0) continue;

    const { error } = await sb.from("payments").insert({
      status: "completed",
      data: {
        invoice_id: ctx.invoicingId,
        ...(ctx.patientId !== undefined && ctx.patientId !== null
          ? { patient_id: ctx.patientId }
          : {}),
        amount,
        currency: p.currency_code ?? ctx.fallbackCurrency,
        method: "paypal",
        paypal_method: p.method,
        paypal_invoice_id: ctx.paypalInvoiceId,
        paypal_payment_id: p.payment_id,
        paid_at: p.paid_at,
        source: "healthcare-org-gateway",
      },
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue;
      throw new HttpError(500, "db_error", error.message);
    }
    recorded += 1;
  }
  return recorded;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET" && req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only GET and POST are supported");
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) throw new HttpError(400, "bad_id", "id must be numeric");

    const sb = serverClient();
    const { data: raw, error } = await sb
      .from("invoicing")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new HttpError(500, "db_error", error.message);
    if (!raw) throw new HttpError(404, "not_found", `no invoicing row with id ${id}`);
    const existingData = ((raw as Row).data ?? {}) as Record<string, unknown>;
    const invoice = mergeRow(raw as Row) as Record<string, unknown>;

    const paypalInvoiceId = existingData.paypal_invoice_id;
    if (!paypalInvoiceId) {
      throw new HttpError(409, "not_sent", `invoicing row ${id} has not been sent via PayPal yet`);
    }

    const remote = await getInvoiceWithPayments(String(paypalInvoiceId));
    const paypalStatus = remote.invoice.status;
    const local = paypalStatus ? LOCAL_STATUS[paypalStatus.toUpperCase()] : undefined;

    // The same data-over-column precedence ./send.ts uses: the typed `status`
    // column defaults to "active" and would shadow the lifecycle state the
    // seeded rows keep in `data`.
    const stateBefore = String(existingData.status ?? invoice.status ?? "").toLowerCase();
    const paidAmount = remote.paid_amount === null ? null : Number(remote.paid_amount);

    // Payments first: it is idempotent, so if the row update below fails a
    // retry still converges instead of double-recording.
    const recorded = await recordPayments(
      sb,
      {
        invoicingId: id,
        patientId: invoice.patient_id,
        paypalInvoiceId: String(paypalInvoiceId),
        fallbackCurrency: remote.invoice.currency_code,
      },
      remote.payments,
    );

    const statusMoved = local !== undefined && stateBefore !== local;
    const changed =
      statusMoved ||
      existingData.paypal_invoice_status !== paypalStatus ||
      (existingData.paid_amount ?? null) !== paidAmount;

    let row: Row = raw as Row;
    if (changed) {
      const now = new Date().toISOString();
      const latestPaidAt = remote.payments
        .map((p) => p.paid_at)
        .filter((d): d is string => d !== null)
        .sort()
        .pop();
      const { data: updated, error: updateErr } = await sb
        .from("invoicing")
        .update({
          // Both the column and the jsonb copy: ./send.ts reads data.status
          // first, so moving only the column would leave a paid invoice
          // looking "sent" and eligible for another send.
          ...(local ? { status: local } : {}),
          data: {
            ...existingData,
            ...(local ? { status: local } : {}),
            paypal_invoice_status: paypalStatus,
            paid_amount: paidAmount,
            ...(latestPaidAt ? { paid_at: latestPaidAt } : {}),
          },
          updated_at: now,
        })
        .eq("id", id)
        .select()
        .single();
      if (updateErr) throw new HttpError(500, "db_error", updateErr.message);
      row = updated as Row;
    }

    if (recorded > 0 || statusMoved) {
      const { error: notifErr } = await sb.from("notifications").insert({
        status: "sent",
        data: {
          kind: "invoice_payment_recorded",
          provider: "paypal",
          invoicing_id: id,
          patient_id: invoice.patient_id,
          paypal_invoice_id: String(paypalInvoiceId),
          paypal_status: paypalStatus,
          local_status: local ?? stateBefore,
          payments_recorded: recorded,
          paid_amount: paidAmount,
          currency: remote.invoice.currency_code,
          recorded_at: new Date().toISOString(),
        },
      });
      if (notifErr) throw new HttpError(500, "db_error", notifErr.message);
    }

    res.status(200).json({
      ...(mergeRow(row) as Record<string, unknown>),
      paypal_invoice: { ...remote.invoice, paid_amount: remote.paid_amount },
      complete: local ? TERMINAL.has(local) : false,
      payments_recorded: recorded,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
