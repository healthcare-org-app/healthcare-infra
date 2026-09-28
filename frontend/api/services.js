import { RESOURCES } from "./_lib/registry.js";
import { requireApiKey } from "./_lib/auth.js";
import { withCors } from "./_lib/cors.js";
import { sendError } from "./_lib/errors.js";
async function handler(req, res) {
    try {
        requireApiKey(req);
        res.status(200).json({ count: RESOURCES.length, resources: RESOURCES });
    }
    catch (err) {
        sendError(res, err);
    }
}
export default withCors(handler);
