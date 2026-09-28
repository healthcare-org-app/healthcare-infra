export function withCors(handler) {
    return async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Max-Age", "86400");
        if (req.method === "OPTIONS") {
            res.status(204).end();
            return;
        }
        await handler(req, res);
    };
}
