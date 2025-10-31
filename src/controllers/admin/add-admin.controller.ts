import { cloudinary } from "@/config/cloudinary";
import { ENV } from "@/config/env";
import type { IAdmin } from "@/types";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { prisma } from "@/utils/db";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";

export async function addAdmin(req: Request, res: Response) {
    const { name, email, mobile, photo }: IAdmin = req.body;

    if (!name || !email || !mobile || !photo) {
        throwError({ statusCode: 400, message: "Missing required fields" });
    }
    if (!photo?.image_url || !photo.public_id) {
        throwError({
            message: "Employee Image is requilred, some fields are missing!",
            statusCode: 400,
        });
    }
    const isExist = await prisma.admin.findUnique({
        where: {
            email,
        },
    });

    if (isExist) {
        throwError({ statusCode: 400, message: "Admin already exists" });
    }

    let imageId;

    const newPublicId = photo.public_id.replace(
        ENV.TEMP_CLOUDINARY_UPLOAD_PRESET,
        `${ENV.CLOUDINARY_UPLOAD_PRESET_BASE}${ENV.EMPLOYEE_CLOUDINARY_UPLOAD_PRESET}`
    );

    const renameResult = await cloudinary.uploader.rename(
        photo.public_id,
        newPublicId,
        { overwrite: true }
    );

    if (renameResult?.public_id) {
        const newUrl = cloudinary.url(renameResult.public_id, {
            secure: true,
        });

        const avatar = await prisma.images.create({
            data: {
                public_id: renameResult.public_id,
                image_url: newUrl,
            },
        });
        imageId = avatar.id;
        console.log(avatar);
    }
    const newAdin = await prisma.admin.create({
        data: {
            name,
            email,
            mobile,
            avatar: {
                connect: { id: imageId },
            },
        },
    });

    if (!newAdin) {
        throwError({ statusCode: 500, message: "Failed to create admin" });
    }

    return sendSuccessResponse({
        response: res,
        data: newAdin,
        message: "Admin created successfully",
    });
}
