import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess } from "@lib/response";
import { buildUploadSignature } from "@lib/cloudinary-signature";

export const UploadController = {
    /**
     * Hands the browser a short-lived signature so it can POST the file
     * directly to Cloudinary. The bytes never pass through this server.
     */
    async signature(c: Context) {
        return withHandler(c, async () => {
            const folder = c.req.query("folder") || "employees";
            return sendSuccess(c, buildUploadSignature(folder), "Upload signature issued");
        });
    },
};
