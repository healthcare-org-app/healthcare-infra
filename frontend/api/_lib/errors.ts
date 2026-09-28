import type { VercelResponse } from "@vercel/node";

export class HttpError extends Error {
  code: string;
  status: number;
  // Optional machine-readable payload. A 409 for a double-booked slot is only
  // actionable if the caller can see *what* it collided with, and a bare
  // message string cannot carry that.
  detail?: unknown;
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function sendError(res: VercelResponse, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.detail === undefined ? {} : { detail: err.detail }),
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: { code: "internal", message } });
}
