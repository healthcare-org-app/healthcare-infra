/**
 * Local mock of the Notion API, wrapped by frontend/api/_lib/notion.ts.
 *
 * Point the gateway at this mock with: NOTION_BASE_URL=http://localhost:4024/v1
 * NOTION_API_KEY can be any value — not validated by this mock.
 *
 * @endpoint GET /v1/databases/:databaseId
 * @endpoint POST /v1/pages
 * @endpoint GET /v1/pages/:pageId
 * @endpoint PATCH /v1/pages/:pageId
 */
const http = require("http");
const PORT = process.env.PORT || 4024;
const JSON_HEADER = { "Content-Type": "application/json" };

// A representative schema: one of each property type the gateway's
// toPropertyValue()/plainValue() shorthand actually handles.
const MOCK_DATABASE_PROPERTIES = {
  Name: { id: "title", type: "title", title: {} },
  Status: { id: "status", type: "status", status: {} },
  Notes: { id: "notes", type: "rich_text", rich_text: {} },
  Amount: { id: "amount", type: "number", number: {} },
  Email: { id: "email", type: "email", email: {} },
  Tags: { id: "tags", type: "multi_select", multi_select: {} },
  Due: { id: "due", type: "date", date: {} },
};

let pageSeq = 0;

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

function notFound(res, message) {
  res.writeHead(404, JSON_HEADER);
  res.end(JSON.stringify({ object: "error", status: 404, code: "object_not_found", message }));
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const pathname = new URL(req.url || "", "http://localhost").pathname;
  const requestedStatusCode = req.headers["x-mock-response-code"];

  // @endpoint GET /v1/databases/:databaseId
  let m = pathname.match(/^\/v1\/databases\/([^/]+)$/);
  if (method === "GET" && m) {
    if (requestedStatusCode === "404") return notFound(res, "Could not find database.");
    res.writeHead(200, JSON_HEADER);
    return res.end(
      JSON.stringify({ object: "database", id: m[1], title: [], properties: MOCK_DATABASE_PROPERTIES }),
    );
  }

  // @endpoint POST /v1/pages
  if (method === "POST" && pathname === "/v1/pages") {
    const body = await readJsonBody(req);

    // "422 Unprocessable Entity" — forced via x-mock-response-code: 422,
    // mirrors Notion's 400 for a property it refused (mapped by notion.ts).
    if (requestedStatusCode === "422") {
      res.writeHead(400, JSON_HEADER);
      return res.end(
        JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "body failed validation." }),
      );
    }

    pageSeq += 1;
    const now = new Date().toISOString();
    const page = {
      object: "page",
      id: `mock-page-${pageSeq}`,
      url: `https://notion.so/mock-page-${pageSeq}`,
      archived: false,
      created_time: now,
      last_edited_time: now,
      parent: body.parent,
      properties: body.properties || {},
    };
    await pm.state.set(`page:${page.id}`, page);

    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify(page));
  }

  // @endpoint GET /v1/pages/:pageId
  m = pathname.match(/^\/v1\/pages\/([^/]+)$/);
  if (method === "GET" && m) {
    const page = await pm.state.get(`page:${m[1]}`);
    if (!page || requestedStatusCode === "404") {
      return notFound(res, "Could not find page with ID — make sure the relevant pages and databases are shared with your integration.");
    }
    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify(page));
  }

  // @endpoint PATCH /v1/pages/:pageId
  if (method === "PATCH" && m) {
    // Attach the body's data/end listeners before the first await below —
    // the request is already streaming, and a late listener never fires.
    const bodyPromise = readJsonBody(req);
    const page = await pm.state.get(`page:${m[1]}`);
    if (!page) return notFound(res, "Could not find page with ID.");

    if (requestedStatusCode === "422") {
      res.writeHead(400, JSON_HEADER);
      return res.end(
        JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "body failed validation." }),
      );
    }

    const body = await bodyPromise;
    if (body.properties) page.properties = { ...page.properties, ...body.properties };
    if (body.archived !== undefined) page.archived = body.archived;
    page.last_edited_time = new Date().toISOString();
    await pm.state.set(`page:${m[1]}`, page);

    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify(page));
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
