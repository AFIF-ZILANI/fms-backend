import { sendSuccessResponse } from "@/utils/apiResponse";
import { prisma } from "@/utils/db";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";

export async function RemoveBatch(req: Request, res: Response) {
    const { ids }: { ids: string[] } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return throwError({
            message: "No valid batch IDs provided.",
            statusCode: 400,
        });
    }

    try {
        const deleted = await prisma.batch.deleteMany({
            where: { id: { in: ids } },
        });

        if (deleted.count === 0) {
            return throwError({
                message: "No batches found with the provided IDs.",
                statusCode: 404,
            });
        }

        return sendSuccessResponse({
            response: res,
            message: "Batches removed successfully",
            data: { deletedCount: deleted.count },
        });
    } catch (error) {
        console.error("Batch removal failed:", error);
        throwError({
            message: "Failed to remove batches",
            statusCode: 500,
        });
    }
}
