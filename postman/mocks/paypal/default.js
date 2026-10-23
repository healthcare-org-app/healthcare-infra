/**
 * Local mock of PayPal Invoicing v2, wrapped by frontend/api/_lib/paypal.ts.
 *
 * Point the gateway at this mock with: PAYPAL_API_BASE=http://localhost:4022
 * PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET can be any values — not validated.
 *
 * @endpoint POST /v1/oauth2/token
 * @endpoint POST /v2/invoicing/invoices
 * @endpoint POST /v2/invoicing/invoices/:id/send
 * @endpoint GET /v2/invoicing/invoices/:id
 */
const http = require("http");
const PORT = process.env.PORT || 4022;
const JSON_HEADER = { "Content-Type": "application/json" };

let invoiceSeq = 0;

function readRawBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function asInvoiceResponse(invoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    detail: invoice.detail,
    invoicer: invoice.invoicer,
    primary_recipients: invoice.primary_recipients,
    items: invoice.items,
    amount: invoice.amount,
    links: [{ rel: "self", href: `http://localhost:${PORT}/v2/invoicing/invoices/${invoice.id}`, method: "GET" }],
  };
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const pathname = new URL(req.url || "", "http://localhost").pathname;
  const requestedStatusCode = req.headers["x-mock-response-code"];

  // @endpoint POST /v1/oauth2/token
  if (method === "POST" && pathname === "/v1/oauth2/token") {
    await readRawBody(req); // Basic-auth client credentials — unverified by this mock
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ access_token: "mock-paypal-access-token", token_type: "Bearer", expires_in: 32400 }));
  }

  // @endpoint POST /v2/invoicing/invoices
  if (method === "POST" && pathname === "/v2/invoicing/invoices") {
    const body = await readJsonBody(req);

    // "422 Unprocessable Entity" — forced via x-mock-response-code: 422,
    // mirrors a bad amount/email PayPal rejects from the built request.
    if (requestedStatusCode === "422") {
      res.writeHead(422, JSON_HEADER);
      return res.end(
        JSON.stringify({
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
          details: [{ issue: "INVALID_RECIPIENT_EMAIL", description: "The recipient email address is not valid." }],
          debug_id: "mock-debug-id",
        }),
      );
    }

    invoiceSeq += 1;
    const amountValue = (body.items || []).reduce(
      (sum, item) => sum + Number(item.unit_amount?.value || 0) * Number(item.quantity || 1),
      0,
    );
    const invoice = {
      id: `INV2-MOCK-${String(invoiceSeq).padStart(4, "0")}`,
      status: "DRAFT",
      detail: body.detail,
      invoicer: body.invoicer,
      primary_recipients: body.primary_recipients,
      items: body.items,
      amount: { currency_code: body.detail?.currency_code || "USD", value: amountValue.toFixed(2) },
    };
    await pm.state.set(`invoice:${invoice.id}`, invoice);

    res.writeHead(201, JSON_HEADER);
    return res.end(JSON.stringify(asInvoiceResponse(invoice)));
  }

  // @endpoint POST /v2/invoicing/invoices/:id/send
  let m = pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/send$/);
  if (method === "POST" && m) {
    const invoiceId = m[1];
    const invoice = await pm.state.get(`invoice:${invoiceId}`);
    if (!invoice) {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ name: "INVOICE_NOT_FOUND", message: "Invoice not found." }));
    }
    invoice.status = "SENT";
    await pm.state.set(`invoice:${invoiceId}`, invoice);

    res.writeHead(202, JSON_HEADER);
    return res.end(
      JSON.stringify({ href: `http://localhost:${PORT}/mock-payer-view/${invoiceId}`, rel: "payer-view", method: "GET" }),
    );
  }

  // @endpoint GET /v2/invoicing/invoices/:id
  m = pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)$/);
  if (method === "GET" && m) {
    const invoiceId = m[1];
    const invoice = await pm.state.get(`invoice:${invoiceId}`);
    if (!invoice || requestedStatusCode === "404") {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ name: "INVOICE_NOT_FOUND", message: "Invoice not found." }));
    }
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify(asInvoiceResponse(invoice)));
  }

  res.writeHead(404, JSON_HEADER);
  res.end(
    JSON.stringify({
      error: "Endpoint not defined",
      message: `Please add ${req.url} endpoint to this mock.`,
    }),
  );
});

server.listen(PORT, () => console.log(`Mock server on port ${PORT}`));
