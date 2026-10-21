import { HttpError } from "./errors.js";

const NERDGRAPH = {
  us: "https://api.newrelic.com/graphql",
  eu: "https://api.eu.newrelic.com/graphql",
} as const;

export type DeploymentMarker = {
  version: string;
  commit?: string;
  user?: string;
  description?: string;
  changelog?: string;
  deepLink?: string;
  groupId?: string;
  timestamp?: number;
};

async function nerdgraph<T>(query: string): Promise<T> {
  const apiKey = process.env.NEW_RELIC_USER_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "misconfigured", "NEW_RELIC_USER_API_KEY not set");
  }
  const region = process.env.NEW_RELIC_REGION?.toLowerCase() === "eu" ? "eu" : "us";
  const res = await fetch(process.env.NEW_RELIC_NERDGRAPH_URL ?? NERDGRAPH[region], {
    method: "POST",
    headers: { "content-type": "application/json", "API-Key": apiKey },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string }[];
  } | null;
  if (!res.ok || !body?.data || body.errors?.length) {
    throw new HttpError(502, "newrelic_error", `NerdGraph request failed (HTTP ${res.status})`, {
      errors: body?.errors?.map((e) => e.message),
    });
  }
  return body.data;
}

// GraphQL string literals are JSON-compatible, so JSON.stringify both quotes and escapes.
const lit = (s: string): string => JSON.stringify(s);

export async function resolveEntityGuid(): Promise<string> {
  const pinned = process.env.NEW_RELIC_ENTITY_GUID;
  if (pinned) return pinned;

  const name = process.env.NEW_RELIC_APP_NAME ?? "myhealthcare-gateway";
  const accountId = process.env.NEW_RELIC_ACCOUNT_ID;
  const search =
    `name = '${name.replace(/'/g, "\\'")}'` + (accountId && /^\d+$/.test(accountId) ? ` AND accountId = ${accountId}` : "");
  const data = await nerdgraph<{
    actor: { entitySearch: { results: { entities: { guid: string; domain: string }[] } } };
  }>(`{ actor { entitySearch(query: ${lit(search)}) { results { entities { guid domain } } } } }`);

  const entities = data.actor.entitySearch.results.entities;
  const entity = entities.find((e) => e.domain === "EXT") ?? entities[0];
  if (!entity) {
    throw new HttpError(
      502,
      "newrelic_entity_not_found",
      `no New Relic entity named '${name}' yet — it appears after the gateway serves its first traced request`,
    );
  }
  return entity.guid;
}

export async function createDeployment(
  entityGuid: string,
  d: DeploymentMarker,
): Promise<{ deploymentId: string; entityGuid: string; version: string }> {
  const fields = [
    `entityGuid: ${lit(entityGuid)}`,
    `version: ${lit(d.version)}`,
    "deploymentType: BASIC",
    ...(d.commit ? [`commit: ${lit(d.commit)}`] : []),
    ...(d.user ? [`user: ${lit(d.user)}`] : []),
    ...(d.description ? [`description: ${lit(d.description)}`] : []),
    ...(d.changelog ? [`changelog: ${lit(d.changelog)}`] : []),
    ...(d.deepLink ? [`deepLink: ${lit(d.deepLink)}`] : []),
    ...(d.groupId ? [`groupId: ${lit(d.groupId)}`] : []),
    ...(d.timestamp ? [`timestamp: ${Math.trunc(d.timestamp)}`] : []),
  ];
  const data = await nerdgraph<{
    changeTrackingCreateDeployment: { deploymentId: string; entityGuid: string; version: string };
  }>(
    `mutation { changeTrackingCreateDeployment(deployment: { ${fields.join(", ")} }) { deploymentId entityGuid version } }`,
  );
  return data.changeTrackingCreateDeployment;
}
