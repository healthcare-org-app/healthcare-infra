import { HttpError } from "./errors.js";
// Notion. Bearer-authenticated JSON, plus a mandatory version header — Notion
// treats the version as part of the request contract and rejects calls without
// it rather than defaulting to the newest.
const BASE_URL = "https://api.notion.com/v1";
// Pinned deliberately. Under `2022-06-28` a page is created against
// `parent.database_id`; from `2025-09-03` a database fans out into data sources
// and creates address `parent.data_source_id` instead. Bumping this without
// reworking createPageInDatabase would break every write, so the override
// exists for testing a migration, not for routine use.
const DEFAULT_VERSION = "2022-06-28";
function apiKey() {
    const key = process.env.NOTION_API_KEY;
    if (!key) {
        throw new HttpError(500, "misconfigured", "NOTION_API_KEY is not set");
    }
    return key;
}
/** The database writes fall back to when a request omits `database_id`. */
export function defaultDatabaseId() {
    const id = process.env.NOTION_DATABASE_ID?.trim();
    return id || undefined;
}
/**
 * Maps a Notion status onto ours.
 *
 * 401/403 mean *our* integration token is missing or under-scoped. Passing
 * those through would tell the caller their gateway key was rejected, which is
 * the wrong thing to go debug, so they collapse into 502 with Notion's message.
 */
function mapStatus(providerStatus) {
    switch (providerStatus) {
        // The caller's payload is what Notion refused, not the request framing.
        case 400:
            return 422;
        // Notion answers 404 both for "no such page" and for "this integration was
        // never shared that page" — indistinguishable from here. The message it
        // returns is the only signal, so it rides along verbatim.
        case 404:
            return 404;
        case 409:
            return 409;
        case 429:
            return 429;
        default:
            return 502;
    }
}
async function request(method, path, body) {
    let resp;
    try {
        resp = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${apiKey()}`,
                "Notion-Version": process.env.NOTION_VERSION?.trim() || DEFAULT_VERSION,
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }
    catch (err) {
        // Network-level failure: Notion never saw the request.
        throw new HttpError(502, "provider_unreachable", err instanceof Error ? err.message : String(err));
    }
    const text = await resp.text();
    let parsed = {};
    if (text) {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = { raw: text };
        }
    }
    if (!resp.ok) {
        // Notion error bodies are { object: "error", status, code, message }.
        const code = String(parsed.code ?? `http_${resp.status}`);
        const message = String(parsed.message ?? `Notion returned ${resp.status}`);
        throw new HttpError(mapStatus(resp.status), `notion_${code}`, message);
    }
    return parsed;
}
function extractTypes(raw) {
    const out = {};
    for (const [name, def] of Object.entries((raw ?? {}))) {
        const type = def?.type;
        if (typeof type === "string")
            out[name] = type;
    }
    return out;
}
const schemaCache = new Map();
const SCHEMA_TTL_MS = 5 * 60 * 1000;
/**
 * Reads a database's property types so scalar inputs can be widened into
 * Notion's tagged property objects.
 *
 * Cached briefly because Notion rate-limits at roughly three requests a second
 * and every create would otherwise spend one of them on a schema read. A schema
 * edit made in Notion still takes effect within the TTL, and a warm cache is
 * only ever a latency win — a stale type produces a 422 from Notion, not a
 * silently wrong write.
 */
async function databasePropertyTypes(databaseId) {
    const hit = schemaCache.get(databaseId);
    if (hit && Date.now() - hit.at < SCHEMA_TTL_MS)
        return hit.types;
    const db = await request("GET", `/databases/${encodeURIComponent(databaseId)}`);
    const types = extractTypes(db.properties);
    schemaCache.set(databaseId, { types, at: Date.now() });
    return types;
}
// Notion computes these. A write that names one is rejected by the API, so it
// is caught here instead, where the error can say which property was at fault.
const READ_ONLY_TYPES = new Set([
    "formula",
    "rollup",
    "created_time",
    "created_by",
    "last_edited_time",
    "last_edited_by",
    "unique_id",
]);
function richText(content) {
    return [{ type: "text", text: { content } }];
}
function scalar(name, value) {
    if (value === null || value === undefined) {
        throw new HttpError(422, "bad_property", `'${name}' must not be null`);
    }
    if (typeof value === "object") {
        throw new HttpError(422, "bad_property", `'${name}' must be a scalar, got ${Array.isArray(value) ? "an array" : "an object"}`);
    }
    return String(value);
}
function toList(value) {
    if (value === null || value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
/**
 * Widens one caller-supplied value into a Notion property value.
 *
 * Scalars and arrays get the shorthand treatment below. An object is taken as
 * already-shaped Notion input and passed through — either fully tagged
 * (`{ date: { start } }`) or as just the inner value (`{ start }`), which is
 * wrapped. That is the escape hatch for shapes with no useful shorthand: file
 * lists, date ranges, rich text carrying mentions or links.
 */
function toPropertyValue(name, type, value) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const obj = value;
        return type in obj ? obj : { [type]: obj };
    }
    switch (type) {
        case "title":
            return { title: richText(scalar(name, value)) };
        case "rich_text":
            return { rich_text: richText(scalar(name, value)) };
        case "number": {
            if (value === null)
                return { number: null };
            const n = typeof value === "number" ? value : Number(String(value).trim());
            if (!Number.isFinite(n)) {
                throw new HttpError(422, "bad_property", `'${name}' must be a number, got ${JSON.stringify(value)}`);
            }
            return { number: n };
        }
        case "select":
            return { select: value === null ? null : { name: scalar(name, value) } };
        case "status":
            return { status: value === null ? null : { name: scalar(name, value) } };
        case "multi_select":
            return { multi_select: toList(value).map((v) => ({ name: scalar(name, v) })) };
        case "date":
            // ISO 8601, date or datetime. A range needs the object form.
            return { date: value === null ? null : { start: scalar(name, value) } };
        case "checkbox": {
            if (typeof value === "boolean")
                return { checkbox: value };
            const s = String(value).toLowerCase();
            if (s === "true")
                return { checkbox: true };
            if (s === "false")
                return { checkbox: false };
            throw new HttpError(422, "bad_property", `'${name}' must be true or false, got ${JSON.stringify(value)}`);
        }
        case "url":
        case "email":
        case "phone_number":
            return { [type]: value === null ? null : scalar(name, value) };
        case "people":
            return { people: toList(value).map((v) => ({ object: "user", id: scalar(name, v) })) };
        case "relation":
            return { relation: toList(value).map((v) => ({ id: scalar(name, v) })) };
        case "files":
            throw new HttpError(422, "unsupported_property", `'${name}' is a files property and has no shorthand; pass the full Notion value, ` +
                `e.g. { "files": [ { "name": "scan.pdf", "external": { "url": "https://…" } } ] }`);
        default:
            throw new HttpError(422, "unsupported_property", `'${name}' has Notion type '${type}', which has no shorthand; pass the full Notion property value object`);
    }
}
/**
 * Converts a flat `{ Name: "Q3 audit", Status: "Open" }` body into the tagged
 * property map Notion wants, validating every name against the schema first so
 * a typo surfaces as a named error rather than a silently dropped field.
 */
export function buildProperties(input, types) {
    const out = {};
    for (const [name, value] of Object.entries(input)) {
        const type = types[name];
        if (!type) {
            const known = Object.keys(types);
            throw new HttpError(422, "unknown_property", `'${name}' is not a property here. Known properties: ${known.length ? known.join(", ") : "(none)"}`);
        }
        if (READ_ONLY_TYPES.has(type)) {
            throw new HttpError(422, "read_only_property", `'${name}' is a ${type} property computed by Notion and cannot be written`);
        }
        out[name] = toPropertyValue(name, type, value);
    }
    return out;
}
function plainText(rich) {
    if (!Array.isArray(rich))
        return "";
    return rich.map((r) => String(r?.plain_text ?? "")).join("");
}
/** Inverse of the shorthand: Notion's tagged value → plain JSON. */
function plainValue(prop) {
    const type = String(prop.type ?? "");
    const value = prop[type];
    switch (type) {
        case "title":
        case "rich_text":
            return plainText(value);
        case "select":
        case "status":
            return value ? String(value.name ?? "") : null;
        case "multi_select":
            return toList(value).map((o) => String(o?.name ?? ""));
        case "people":
        case "relation":
            return toList(value).map((o) => String(o?.id ?? ""));
        case "number":
        case "checkbox":
        case "url":
        case "email":
        case "phone_number":
            return value ?? null;
        // Dates, files, formulas and rollups keep Notion's own shape: flattening
        // would drop fields (a date's `end`, a rollup's `type`) the caller needs.
        default:
            return value ?? null;
    }
}
function asPage(raw) {
    const props = (raw.properties ?? {});
    const properties = {};
    for (const [name, def] of Object.entries(props)) {
        properties[name] = plainValue((def ?? {}));
    }
    const parent = (raw.parent ?? null);
    // Notion tags the parent by type and keys the id under that same type,
    // e.g. { type: "database_id", database_id: "…" }.
    const parentType = parent ? String(parent.type ?? "") : "";
    return {
        id: String(raw.id ?? ""),
        url: raw.url ? String(raw.url) : null,
        archived: raw.archived === true,
        created_time: raw.created_time ? String(raw.created_time) : null,
        last_edited_time: raw.last_edited_time ? String(raw.last_edited_time) : null,
        parent: parent
            ? { type: parentType, id: parent[parentType] ? String(parent[parentType]) : null }
            : null,
        properties,
        property_types: extractTypes(props),
    };
}
/** Creates a page as a row of `databaseId`, coercing properties to its schema. */
export async function createPageInDatabase(opts) {
    const types = await databasePropertyTypes(opts.databaseId);
    const created = await request("POST", "/pages", {
        parent: { database_id: opts.databaseId },
        properties: buildProperties(opts.properties, types),
        ...(opts.children ? { children: opts.children } : {}),
        ...(opts.icon ? { icon: opts.icon } : {}),
        ...(opts.cover ? { cover: opts.cover } : {}),
    });
    return asPage(created);
}
/**
 * Creates a page nested under another page. A page parent has no schema, so
 * `title` is the only property Notion accepts here.
 */
export async function createChildPage(opts) {
    const created = await request("POST", "/pages", {
        parent: { page_id: opts.parentPageId },
        properties: { title: { title: richText(opts.title) } },
        ...(opts.children ? { children: opts.children } : {}),
        ...(opts.icon ? { icon: opts.icon } : {}),
        ...(opts.cover ? { cover: opts.cover } : {}),
    });
    return asPage(created);
}
/** Reads a page's properties. Does not read its block content. */
export async function retrievePage(pageId) {
    return asPage(await request("GET", `/pages/${encodeURIComponent(pageId)}`));
}
/**
 * Updates the named properties, leaving every other property untouched, and
 * optionally moves the page into or out of the archive.
 *
 * The page is read first to learn its property types — a page response carries
 * the type of each property, so this works for a page under any parent without
 * the caller having to name the database. The read is skipped when the call
 * only toggles `archived`.
 */
export async function updatePage(opts) {
    const wanted = opts.properties ?? {};
    const hasProperties = Object.keys(wanted).length > 0;
    const types = hasProperties ? (await retrievePage(opts.pageId)).property_types : {};
    const updated = await request("PATCH", `/pages/${encodeURIComponent(opts.pageId)}`, {
        ...(hasProperties ? { properties: buildProperties(wanted, types) } : {}),
        ...(opts.archived === undefined ? {} : { archived: opts.archived }),
        ...(opts.icon ? { icon: opts.icon } : {}),
        ...(opts.cover ? { cover: opts.cover } : {}),
    });
    return asPage(updated);
}
