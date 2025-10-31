import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";
import { prisma } from "@/utils/db";
import { cloudinary } from "@/config/cloudinary";
import type { Request, Response } from "express";

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
        await Promise.all(
            ids.map(async (supplierId) => {
                // Fetch supplier with avatar
                const supplier = await prisma.supplier.findUnique({
                    where: { id: supplierId },
                    include: { avatar: true }, // adjust relation name if needed
                });

                // console.log(supplier)
                if (!supplier) {
                    throwError({
                        message: "Invalid supplier Id",
                        statusCode: 400,
                    });
                }

                // Delete avatar from Cloudinary if exists
                if (supplier.avatar?.public_id) {
                    await cloudinary.uploader.destroy(
                        supplier.avatar.public_id
                    );
                }

                // Delete avatar record from DB
                if (supplier.avatar) {
                    await prisma.images.delete({
                        where: { id: supplier.avatar.id },
                    });
                }

                // Delete supplier record
                await prisma.supplier.delete({
                    where: { id: supplierId },
                });
            })
        );

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
