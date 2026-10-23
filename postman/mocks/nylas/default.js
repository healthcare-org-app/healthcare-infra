/**
 * Local mock of Nylas v3, wrapped by frontend/api/_lib/nylas.ts.
 *
 * Point the gateway at this mock with: NYLAS_API_URI=http://localhost:4023
 * NYLAS_API_KEY / NYLAS_CLIENT_ID / NYLAS_CALLBACK_URI can be any values —
 * not validated by this mock.
 *
 * Grants aren't modeled upstream here — any grantId in the path is accepted
 * and gets its own seeded inbox/calendar on first use.
 *
 * @endpoint POST /v3/connect/token
 * @endpoint DELETE /v3/grants/:grantId
 * @endpoint GET /v3/grants/:grantId/messages
 * @endpoint GET /v3/grants/:grantId/messages/:id
 * @endpoint POST /v3/grants/:grantId/messages/send
 * @endpoint GET /v3/grants/:grantId/calendars
 * @endpoint GET /v3/grants/:grantId/events
 * @endpoint GET /v3/grants/:grantId/events/:id
 * @endpoint POST /v3/grants/:grantId/events
 * @endpoint DELETE /v3/grants/:grantId/events/:id
 * @endpoint POST /v3/grants/:grantId/calendars/free-busy
 * @endpoint POST /v3/calendars/availability
 */
const http = require("http");
const PORT = process.env.PORT || 4023;
const JSON_HEADER = { "Content-Type": "application/json" };

let eventSeq = 0;

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

async function seedMessages(grantId) {
  const key = `messages:${grantId}`;
  const existing = await pm.state.get(key);
  if (existing) return existing;
  const seeded = [
    {
      id: "mock-message-1",
      thread_id: "mock-thread-1",
      subject: "Appointment reminder",
      from: [{ email: "clinic@example.com", name: "The Clinic" }],
      to: [{ email: "patient@example.com", name: "Pat Patient" }],
      date: Math.floor(Date.now() / 1000) - 3600,
      unread: true,
      starred: false,
      folders: ["INBOX"],
      body: "Your appointment is tomorrow at 10am.",
      cc: [],
      attachments: [],
    },
  ];
  await pm.state.set(key, seeded);
  return seeded;
}

async function seedCalendars(grantId) {
  const key = `calendars:${grantId}`;
  const existing = await pm.state.get(key);
  if (existing) return existing;
  const seeded = [
    { id: "mock-calendar-primary", name: "Primary Calendar", description: null, timezone: "America/New_York", is_primary: true, read_only: false },
  ];
  await pm.state.set(key, seeded);
  return seeded;
}

async function getEvents(grantId) {
  return (await pm.state.get(`events:${grantId}`)) || [];
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;
  const requestedStatusCode = req.headers["x-mock-response-code"];

  function grantFailure() {
    res.writeHead(401, JSON_HEADER);
    res.end(
      JSON.stringify({
        request_id: "mock-request-id",
        error: { type: "invalid_grant", message: "the grant is invalid or has been revoked by the provider" },
      }),
    );
    return true;
  }

  // @endpoint POST /v3/connect/token
  if (method === "POST" && pathname === "/v3/connect/token") {
    await readJsonBody(req);
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({ grant_id: "mock-grant-id", email: "patient@example.com", provider: "google", scope: "calendar email" }),
    );
  }

  // @endpoint POST /v3/calendars/availability (application-scoped, check before grant-scoped routes)
  if (method === "POST" && pathname === "/v3/calendars/availability") {
    const body = await readJsonBody(req);
    const duration = body.duration_minutes || 30;
    const start = body.start_time || Math.floor(Date.now() / 1000);
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({
        request_id: "mock-request-id",
        data: {
          time_slots: [
            { start_time: start, end_time: start + duration * 60, emails: (body.participants || []).map((p) => p.email) },
          ],
        },
      }),
    );
  }

  let m = pathname.match(/^\/v3\/grants\/([^/]+)$/);
  if (method === "DELETE" && m) {
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id" }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/messages\/send$/);
  if (method === "POST" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    await readJsonBody(req);
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: { id: "mock-message-sent-1", thread_id: "mock-thread-1" } }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/messages\/([^/]+)$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const [, grantId, messageId] = m;
    const messages = await seedMessages(grantId);
    const found = messages.find((msg) => msg.id === messageId) || messages[0];
    if (!found) {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ request_id: "mock-request-id", error: { type: "not_found", message: "message not found" } }));
    }
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: found }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/messages$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const messages = await seedMessages(m[1]);
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: messages, next_cursor: null }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/calendars$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const calendars = await seedCalendars(m[1]);
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: calendars }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/calendars\/free-busy$/);
  if (method === "POST" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const body = await readJsonBody(req);
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({
        request_id: "mock-request-id",
        data: (body.emails || []).map((email) => ({
          email,
          time_slots: [{ start_time: body.start_time, end_time: body.start_time ? body.start_time + 1800 : undefined }],
        })),
      }),
    );
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/events\/([^/]+)$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const [, grantId, eventId] = m;
    const events = await getEvents(grantId);
    const found = events.find((e) => e.id === eventId);
    if (!found) {
      res.writeHead(404, JSON_HEADER);
      return res.end(JSON.stringify({ request_id: "mock-request-id", error: { type: "not_found", message: "event not found" } }));
    }
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: found }));
  }

  if (method === "DELETE" && (m = pathname.match(/^\/v3\/grants\/([^/]+)\/events\/([^/]+)$/))) {
    if (requestedStatusCode === "401") return grantFailure();
    const [, grantId, eventId] = m;
    const events = await getEvents(grantId);
    await pm.state.set(`events:${grantId}`, events.filter((e) => e.id !== eventId));
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id" }));
  }

  m = pathname.match(/^\/v3\/grants\/([^/]+)\/events$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    const events = await getEvents(m[1]);
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: events, next_cursor: null }));
  }
  if (method === "POST" && m) {
    if (requestedStatusCode === "401") return grantFailure();
    // "422 Unprocessable Entity" — forced via x-mock-response-code: 422
    if (requestedStatusCode === "422") {
      res.writeHead(422, JSON_HEADER);
      return res.end(JSON.stringify({ request_id: "mock-request-id", error: { type: "invalid_request", message: "event end must be after its start" } }));
    }
    const grantId = m[1];
    const body = await readJsonBody(req);
    eventSeq += 1;
    const event = {
      id: `mock-event-${eventSeq}`,
      calendar_id: parsedUrl.searchParams.get("calendar_id") || "mock-calendar-primary",
      title: body.title,
      description: body.description || null,
      location: body.location || null,
      status: "confirmed",
      busy: body.busy !== false,
      when: body.when,
      participants: body.participants || [],
      conferencing: body.conferencing || null,
      html_link: `http://localhost:${PORT}/mock-event/${eventSeq}`,
    };
    const events = await getEvents(grantId);
    events.push(event);
    await pm.state.set(`events:${grantId}`, events);

    res.writeHead(201, JSON_HEADER);
    return res.end(JSON.stringify({ request_id: "mock-request-id", data: event }));
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
