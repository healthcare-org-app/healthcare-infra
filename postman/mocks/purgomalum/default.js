/**
 * Local mock of PurgoMalum (https://www.purgomalum.com/service/json) — the
 * public, unauthenticated profanity filter wrapped by
 * frontend/api/_lib/purgomalum.ts.
 *
 * Point the gateway at this mock by setting PURGOMALUM_BASE_URL=http://localhost:4020/service/json
 *
 * @endpoint GET /service/json
 */
const http = require("http");
const PORT = process.env.PORT || 4020;
const JSON_HEADER = { "Content-Type": "application/json" };

// A small built-in blocklist, standing in for PurgoMalum's real (much larger)
// dictionary — enough to exercise the gateway's filter path end to end.
const DEFAULT_BLOCKLIST = ["damn", "hell", "crap", "shit", "fuck", "ass", "bitch"];

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const parsedUrl = new URL(req.url || "", "http://localhost");

  // @endpoint GET /service/json
  if (method === "GET" && parsedUrl.pathname === "/service/json") {
    const requestedStatusCode = req.headers["x-mock-response-code"];
    const text = parsedUrl.searchParams.get("text");

    // "400 Bad Request" — malformed caller input (missing text), or forced
    // via x-mock-response-code: 400
    if (text === null || text === "" || requestedStatusCode === "400") {
      res.writeHead(400, JSON_HEADER);
      return res.end(JSON.stringify({ error: "Missing parameter: text" }));
    }

    const add = (parsedUrl.searchParams.get("add") || "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const fillText = parsedUrl.searchParams.get("fill_text");
    const fillChar = parsedUrl.searchParams.get("fill_char");
    const blocklist = new Set([...DEFAULT_BLOCKLIST, ...add]);

    const result = text
      .split(/(\s+)/)
      .map((token) => {
        const bare = token.replace(/[^a-zA-Z]/g, "").toLowerCase();
        if (!bare || !blocklist.has(bare)) return token;
        if (fillText !== null && fillText !== "") return fillText;
        if (fillChar !== null && fillChar !== "") return fillChar.repeat(token.length);
        return "****";
      })
      .join("");

    res.writeHead(200, JSON_HEADER);
    return res.end(JSON.stringify({ result }));
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
