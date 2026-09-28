export class HttpError extends Error {
    code;
    status;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export function sendError(res, err) {
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: { code: "internal", message } });
}
