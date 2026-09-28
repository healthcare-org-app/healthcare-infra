import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireApiKey } from "../../_lib/auth.js";
import { withCors } from "../../_lib/cors.js";
import { HttpError, sendError } from "../../_lib/errors.js";
import { retrievePage, updatePage } from "../../_lib/notion.js";

/**
 * GET   — reads one page's properties (not its block content). The response
 *         carries `property_types`, which is what a subsequent PATCH needs to
 *         know how to shape its values.
 *
 * PATCH — updates only the properties named in the body; everything else on the
 *         page is left alone. Values use the same plain-JSON shorthand the
 *         create endpoint accepts:
 *
 *           { "properties": { "Status": "In review", "Due": "2026-10-15" } }
 *
 *         `{"archived": true}` archives the page — Notion has no page delete,
 *         and archiving is reversible with `{"archived": false}`.
 *
 * A page id Notion has not been shared with comes back as 404, the same as a
 * page that does not exist; Notion does not distinguish the two.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireApiKey(req);

    const pageId = String(req.query.id ?? "").trim();
    if (!pageId) {
      throw new HttpError(400, "bad_path", "page id is required");
    }

    if (req.method === "GET") {
      res.status(200).json(await retrievePage(pageId));
      return;
    }

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const properties = (body.properties ?? {}) as Record<string, unknown>;
      if (typeof properties !== "object" || Array.isArray(properties)) {
        throw new HttpError(400, "bad_body", "'properties' must be an object keyed by property name");
      }

      let archived: boolean | undefined;
      if (body.archived !== undefined) {
        if (typeof body.archived !== "boolean") {
          throw new HttpError(400, "bad_body", "'archived' must be true or false");
        }
        archived = body.archived;
      }

      if (Object.keys(properties).length === 0 && archived === undefined && !body.icon && !body.cover) {
        throw new HttpError(400, "bad_body", "nothing to update: pass 'properties', 'archived', 'icon' or 'cover'");
      }

      const page = await updatePage({
        pageId,
        properties,
        archived,
        icon: body.icon,
        cover: body.cover,
      });
      res.status(200).json(page);
      return;
    }

    throw new HttpError(405, "method_not_allowed", "only GET and PATCH are supported");
  } catch (err) {
    sendError(res, err);
  }
}

export default withCors(handler);
