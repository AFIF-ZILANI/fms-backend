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
            // ponytail: one folder today. A caller-chosen folder would let anyone with a signature
            // write anywhere in the Cloudinary account; add an allow-list when a second kind exists.
            return sendSuccess(c, buildUploadSignature("employees"), "Upload signature issued");
        });
    },
};
