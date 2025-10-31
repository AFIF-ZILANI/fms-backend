import { prisma } from "@/utils/db";
import { ContactMethod, type ISupplier } from "../../types/index";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { SupplierRoleName, SupplyType } from "@prisma/client";
import { cloudinary } from "@/config/cloudinary";
import { ENV } from "@/config/env";

export async function AddSupplier(req: Request, res: Response) {
    const body: ISupplier = req.body;
    const {
        name,
        email,
        photo,
        mobile,
        address,
        role,
        company,
        online_contact,
        type,
    } = body;

    console.log(body);

    if (!name || !mobile || !role || !online_contact || !company || !type) {
        throwError({ statusCode: 400, message: "Missing required fields" });
    }
    if (!Object.values(SupplierRoleName).includes(role)) {
        throwError({ statusCode: 400, message: "Invalid role" });
    }
    online_contact.forEach((method) => {
        if (!Object.values(ContactMethod).includes(method)) {
            throwError({ statusCode: 400, message: "Invalid contact method" });
        }
    });

    if (!Object.values(SupplyType).includes(type)) {
        throwError({ message: "Invalid supplier type", statusCode: 400 });
    }

    if (
        (photo?.image_url && !photo.public_id) ||
        (!photo?.image_url && photo?.public_id)
    ) {
        throwError({ message: "invalid image", statusCode: 400 });
    }
    const exsistSupplier = await prisma.supplier.findFirst({
        where: {
            OR: [{ email: email || undefined }, { mobile }],
        },
    });

    if (exsistSupplier) {
        throwError({ statusCode: 400, message: "Supplier already exists" });
    }

    let imageId;
    if (photo?.image_url && photo.public_id) {
        console.log("photo: ==>",photo)
        // const newPublicId = photo.public_id.replace(
        //     ENV.TEMP_CLOUDINARY_UPLOAD_PRESET,
        //     `${ENV.CLOUDINARY_UPLOAD_PRESET_BASE}${ENV.SUPPLIER_CLOUDINARY_UPLOAD_PRESET}`
        // );
        const newPublicId = `fms/suppliers/${photo.public_id}`;

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
    }

    const newSupplier = await prisma.supplier.create({
        data: {
            name,
            email: email,
            mobile,
            address,
            role,
            online_contact,
            company,
            type: type ? [type as SupplyType] : undefined,
            avatar: imageId ? { connect: { id: imageId } } : undefined,
        },
    });
    console.log(newSupplier);

    if (!newSupplier) {
        throwError({ statusCode: 500, message: "Failed to create supplier" });
    }

    return sendSuccessResponse({
        response: res,
        data: {},
        message: "Supplier created successfully",
    });
}
