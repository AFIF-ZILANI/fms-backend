import { cloudinary } from "@/config/cloudinary";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";

export async function RemoveTempAvatar(req: Request, res: Response) {
    const { id } = req.body;

    if (!id || typeof id !== "string") {
        return throwError({
            message: "Valid image ID required",
            statusCode: 400,
        });
    }

    try {
        const result = await cloudinary.uploader.destroy(id, {
            resource_type: "image",
        });

        if (result.result !== "ok") {
            return throwError({
                message: "Failed to delete image. Check public_id.",
                statusCode: 404,
            });
        }

        return sendSuccessResponse({
            response: res,
            message: "Successfully removed image",
        });
    } catch (error) {
        console.error("Cloudinary delete error:", error);
        return throwError({
            message: "Cloudinary deletion failed",
            statusCode: 500,
        });
    }
}
