import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";

// A claim's own id, amount and status live on claims-submission-service
// (/api/claims_submission/{id}); the patient's name lives on patients-service
// (/api/patients/{patient_id}). claims-status-service rows have their own id
// (a status row id plus a claim_id), so they are not a source for insurance_id.
const UPSTREAM_TIMEOUT_MS = 5000;

type Upstream = { name: string; envVar: string };
const CLAIMS: Upstream = { name: "claims-submission-service", envVar: "CLAIMS_API_URL" };
const PATIENTS: Upstream = { name: "patients-service", envVar: "PATIENTS_API_URL" };

function baseUrl(up: Upstream): string {
  const base = process.env[up.envVar] ?? process.env.GATEWAY_BASE_URL;
  if (!base) throw new HttpError(500, "misconfigured", `${up.envVar} (or GATEWAY_BASE_URL) not set`);
  return base.replace(/\/+$/, "");
}

// Returns null on 404; every other failure is a 502 naming the upstream.
async function getJson(up: Upstream, path: string): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(up)}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GATEWAY_API_KEY ?? ""}`, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "upstream_unavailable", `${up.name} could not be reached`, {
      upstream: up.name,
    });
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new HttpError(502, "upstream_error", `${up.name} responded ${res.status}`, {
      upstream: up.name,
      status: res.status,
    });
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(502, "upstream_error", `${up.name} returned a non-JSON body`, {
      upstream: up.name,
    });
  }
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "only GET is supported");
    }
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "bad_id", "id must be a positive integer");

    const claim = await getJson(CLAIMS, `/api/claims_submission/${id}`);
    if (!claim) throw new HttpError(404, "not_found", `no claim with id ${id}`);

    const patientId = claim.patient_id;
    if (patientId === undefined || patientId === null) {
      throw new HttpError(502, "upstream_error", `claim ${id} has no patient_id`, {
        upstream: CLAIMS.name,
      });
    }
    const patient = await getJson(PATIENTS, `/api/patients/${encodeURIComponent(String(patientId))}`);
    if (!patient) {
      throw new HttpError(502, "upstream_error", `patient ${patientId} for claim ${id} was not found`, {
        upstream: PATIENTS.name,
        status: 404,
      });
    }

    res.status(200).json({
      insurance_id: claim.id,
      patient_name: `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim(),
      amount: claim.amount,
      status: claim.status,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
