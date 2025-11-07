import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";
import { removeRecords } from "@/utils/remove-users";

export async function RemoveSuppliers(req: Request, res: Response) {
    const { ids }: { ids: string[] } = req.body;

    if (!ids || !ids.length) {
        throwError({
            message: "No id found!",
            statusCode: 400,
        });
    }

    console.log(ids);
    try {
        removeRecords({table:"supplier", ids, placeholder: "supplier"})

        return sendSuccessResponse({
            response: res,
            message: "Suppliers removed successfully",
        });
    } catch (error) {
        console.error(error);
        throwError({
            message: "Failed to remove suppliers",
            statusCode: 500,
        });
    }
}
