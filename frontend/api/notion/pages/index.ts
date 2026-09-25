import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { createChildPage, createPageInDatabase, defaultDatabaseId } from "../../_lib/notion.js";

/**
 * POST — creates a Notion page, either as a row of a database or as a child of
 * an existing page.
 *
 * Database parent (the common case). `database_id` may be omitted when
 * NOTION_DATABASE_ID is set. Property values are plain JSON and are widened
 * against the database's own schema, so a select is just its name and a date is
 * just an ISO string:
 *
 *   { "database_id": "…",
 *     "properties": { "Name": "Q3 access audit", "Status": "Open",
 *                     "Due": "2026-09-30", "Owner": ["<notion-user-id>"] } }
 *
 * Page parent — no schema exists, so `title` is the only property:
 *
 *   { "parent_page_id": "…", "title": "Runbook" }
 *
 * `children` takes raw Notion block objects for page body content, and is
 * passed through untouched.
 *
 * Nothing here reads or writes the clinical database. Notion is not a
 * HIPAA-eligible service and will not sign a BAA, so what gets sent is left
 * entirely to the caller rather than assembled from patient rows.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "only POST is supported");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const children = body.children === undefined ? undefined : body.children;
    if (children !== undefined && !Array.isArray(children)) {
      throw new HttpError(400, "bad_body", "'children' must be an array of Notion block objects");
    }

    const parentPageId = String(body.parent_page_id ?? "").trim();
    const databaseId = String(body.database_id ?? "").trim() || (parentPageId ? "" : defaultDatabaseId() ?? "");

    if (parentPageId && databaseId) {
      throw new HttpError(400, "bad_body", "pass either 'database_id' or 'parent_page_id', not both");
    }

    if (parentPageId) {
      const title = String(body.title ?? "").trim();
      if (!title) {
        throw new HttpError(400, "bad_body", "'title' is required when creating a page under 'parent_page_id'");
      }
      const page = await createChildPage({
        parentPageId,
        title,
        children,
        icon: body.icon,
        cover: body.cover,
      });
      res.status(201).json(page);
      return;
    }

    if (!databaseId) {
      throw new HttpError(
        400,
        "bad_body",
        "'database_id' is required (or set NOTION_DATABASE_ID), unless creating under 'parent_page_id'",
      );
    }

    const properties = (body.properties ?? {}) as Record<string, unknown>;
    if (typeof properties !== "object" || Array.isArray(properties)) {
      throw new HttpError(400, "bad_body", "'properties' must be an object keyed by property name");
    }
    if (Object.keys(properties).length === 0) {
      throw new HttpError(400, "bad_body", "'properties' must set at least the database's title property");
    }

    const page = await createPageInDatabase({
      databaseId,
      properties,
      children,
      icon: body.icon,
      cover: body.cover,
    });
    res.status(201).json(page);
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
