import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withCors } from "../_lib/cors.js";
import { HttpError, sendError } from "../_lib/errors.js";
import { createDeployment, resolveEntityGuid } from "../_lib/newrelic.js";

// The signature is an HMAC over the exact bytes Vercel sent, so the body must
// stay unparsed.
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 1_000_000;
const RECORDED_EVENTS = new Set(["deployment.succeeded", "deployment.promoted"]);

type DeploymentEvent = {
  type?: string;
  createdAt?: number;
  payload?: {
    target?: string | null;
    deployment?: {
      id?: string;
      target?: string | null;
      meta?: Record<string, string | undefined>;
    };
    links?: { deployment?: string };
  };
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large", "webhook body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function verifySignature(raw: Buffer, header: string | string[] | undefined): void {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(500, "misconfigured", "VERCEL_WEBHOOK_SECRET not set");
  const provided = Array.isArray(header) ? header[0] : header;
  const expected = createHmac("sha1", secret).update(raw).digest("hex");
  if (
    !provided ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    throw new HttpError(403, "invalid_signature", "signature didn't match");
  }
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "POST only");

    const raw = await readRawBody(req);
    verifySignature(raw, req.headers["x-vercel-signature"]);

    let event: DeploymentEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as DeploymentEvent;
    } catch {
      throw new HttpError(400, "bad_request", "body is not valid JSON");
    }

    const type = event.type ?? "";
    if (!RECORDED_EVENTS.has(type)) {
      res.status(200).json({ recorded: false, reason: "event_not_tracked", type });
      return;
    }

    const payload = event.payload ?? {};
    const deployment = payload.deployment ?? {};
    // A promotion is production by definition; a plain success is only a
    // production change when the target says so — previews must not mark.
    const target = payload.target ?? deployment.target;
    if (type !== "deployment.promoted" && target !== "production") {
      res.status(200).json({ recorded: false, reason: "not_production", type });
      return;
    }

    const meta = deployment.meta ?? {};
    const commit = meta.githubCommitSha;
    const version = commit ?? deployment.id;
    if (!version) throw new HttpError(400, "bad_request", "event has no commit sha or deployment id");

    const entityGuid = await resolveEntityGuid();
    const marker = await createDeployment(entityGuid, {
      version,
      commit,
      user: meta.githubCommitAuthorLogin ?? meta.githubCommitAuthorName,
      description: `Vercel ${type === "deployment.promoted" ? "promotion" : "production deployment"} ${deployment.id ?? ""}`.trim(),
      changelog: meta.githubCommitMessage?.split("\n")[0],
      deepLink: payload.links?.deployment,
      groupId: deployment.id,
      timestamp: event.createdAt,
    });
    res.status(200).json({ recorded: true, ...marker });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
