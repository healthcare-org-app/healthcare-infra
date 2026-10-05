/**
 * Local mock of DocuSign eSignature REST v2.1, wrapped by
 * frontend/api/_lib/docusign.ts.
 *
 * Point the gateway at this mock with:
 *   DOCUSIGN_OAUTH_BASE=http://localhost:4021
 *   DOCUSIGN_API_BASE=http://localhost:4021/restapi
 *   DOCUSIGN_ACCOUNT_ID=mock-account-id   (any value — not validated)
 * DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_USER_ID / DOCUSIGN_PRIVATE_KEY still need
 * to be set to *something* so the gateway can build a JWT assertion locally —
 * this mock never verifies it.
 *
 * @endpoint POST /oauth/token
 * @endpoint GET /oauth/userinfo
 * @endpoint POST /restapi/v2.1/accounts/:accountId/envelopes
 * @endpoint GET /restapi/v2.1/accounts/:accountId/envelopes/:envelopeId
 * @endpoint GET /restapi/v2.1/accounts/:accountId/envelopes/:envelopeId/documents/:documentId
 */
const http = require("http");
const PORT = process.env.PORT || 4021;
const JSON_HEADER = { "Content-Type": "application/json" };

const MOCK_ACCOUNT_ID = "mock-account-id";
let envelopeSeq = 0;

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

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;
  const requestedStatusCode = req.headers["x-mock-response-code"];

  // @endpoint POST /oauth/token
  if (method === "POST" && pathname === "/oauth/token") {
    await readRawBody(req); // JWT assertion — unverified by this mock

    // "401 Unauthorized" — the one auth failure docusign.ts surfaces
    // verbatim: impersonation consent not yet granted.
    if (requestedStatusCode === "401") {
      res.writeHead(401, JSON_HEADER);
      return res.end(
        JSON.stringify({ error: "consent_required", error_description: "required consent not granted" }),
      );
    }

    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ access_token: "mock-docusign-access-token", token_type: "Bearer", expires_in: 3600 }));
  }

  // @endpoint GET /oauth/userinfo
  if (method === "GET" && pathname === "/oauth/userinfo") {
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({
        sub: "mock-user-id",
        accounts: [
          {
            account_id: MOCK_ACCOUNT_ID,
            is_default: true,
            account_name: "Mock Account",
            base_uri: `http://localhost:${PORT}`,
          },
        ],
      }),
    );
  }

  // @endpoint POST /restapi/v2.1/accounts/:accountId/envelopes
  let m = pathname.match(/^\/restapi\/v2\.1\/accounts\/([^/]+)\/envelopes$/);
  if (method === "POST" && m) {
    const body = await readJsonBody(req);

    // "400 Bad Request" — forced via x-mock-response-code: 400, mirrors a
    // malformed envelope (e.g. no signers on routing order 1).
    if (requestedStatusCode === "400") {
      res.writeHead(400, JSON_HEADER);
      return res.end(
        JSON.stringify({
          errorCode: "INVALID_REQUEST_BODY",
          message: "The envelope defined does not have any recipients configured for routing order 1",
        }),
      );
    }

    envelopeSeq += 1;
    const envelopeId = `mock-envelope-${envelopeSeq}`;
    const signers = body.templateId
      ? (body.templateRoles || []).map((r, i) => ({
          recipientId: String(i + 1),
          name: r.name,
          email: r.email,
          status: "sent",
        }))
      : ((body.recipients && body.recipients.signers) || []).map((s) => ({
          recipientId: s.recipientId,
          name: s.name,
          email: s.email,
          status: "sent",
        }));

    const now = new Date().toISOString();
    const envelope = {
      envelopeId,
      status: body.status || "sent",
      statusDateTime: now,
      sentDateTime: body.status === "created" ? null : now,
      completedDateTime: null,
      uri: `/envelopes/${envelopeId}`,
      signers,
    };
    await pm.state.set(`envelope:${envelopeId}`, envelope);

    res.writeHead(201, JSON_HEADER);
    return res.end(
      JSON.stringify({
        envelopeId: envelope.envelopeId,
        status: envelope.status,
        statusDateTime: envelope.statusDateTime,
        uri: envelope.uri,
      }),
    );
  }

  // @endpoint GET /restapi/v2.1/accounts/:accountId/envelopes/:envelopeId/documents/:documentId
  m = pathname.match(/^\/restapi\/v2\.1\/accounts\/([^/]+)\/envelopes\/([^/]+)\/documents\/([^/]+)$/);
  if (method === "GET" && m) {
    const envelopeId = m[2];
    const envelope = await pm.state.get(`envelope:${envelopeId}`);
    if (!envelope) {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ errorCode: "ENVELOPE_DOES_NOT_EXIST", message: "The envelope does not exist." }));
    }
    const pdf = Buffer.from(
      `%PDF-1.4\n% Mock signed document for ${envelopeId}\n1 0 obj<</Type/Catalog>>endobj\n%%EOF`,
      "utf8",
    );
    res.writeHead(200, { "Content-Type": "application/pdf" });
    return res.end(pdf);
  }

  // @endpoint GET /restapi/v2.1/accounts/:accountId/envelopes/:envelopeId
  m = pathname.match(/^\/restapi\/v2\.1\/accounts\/([^/]+)\/envelopes\/([^/]+)$/);
  if (method === "GET" && m) {
    const envelopeId = m[2];
    const envelope = await pm.state.get(`envelope:${envelopeId}`);

    if (!envelope || requestedStatusCode === "404") {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ errorCode: "ENVELOPE_DOES_NOT_EXIST", message: "The envelope does not exist." }));
    }

    const includeRecipients = (parsedUrl.searchParams.get("include") || "").includes("recipients");
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({
        envelopeId: envelope.envelopeId,
        status: envelope.status,
        statusDateTime: envelope.statusDateTime,
        sentDateTime: envelope.sentDateTime,
        completedDateTime: envelope.completedDateTime,
        uri: envelope.uri,
        ...(includeRecipients ? { recipients: { signers: envelope.signers } } : {}),
      }),
    );
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
