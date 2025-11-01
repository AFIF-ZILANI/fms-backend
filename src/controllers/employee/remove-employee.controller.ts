import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";
import { RemoveUsers } from "@/utils/remove-users";
import type { Request, Response } from "express";

export async function RemoveEmployee(req: Request, res: Response) {
    const { ids }: { ids: string[] } = req.body;

    if (!ids || !ids.length) {
        throwError({
            message: "No id found!",
            statusCode: 400,
        });
    }

    console.log(ids);
    try {
        RemoveUsers(ids, "employee");

        return sendSuccessResponse({
            response: res,
            message: "Employees removed successfully",
        });
    } catch (error) {
        console.error(error);
        throwError({
            message: "Failed to remove employees",
            statusCode: 500,
        });
    }
}
