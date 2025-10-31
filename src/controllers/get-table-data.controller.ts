import type { Request, Response } from "express";
import { prisma } from "@/utils/db";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";

export async function findTableData(req: Request, res: Response) {
    const category = req.query.category?.toString().trim() || "";
    const skipValue = req.query.skip?.toString().trim() || "";
    const skip = Number.parseInt(skipValue) || 0;

    console.log("Category:", category);

    let data: any[] = [];

    switch (category.toUpperCase()) {
        case "SUPPLIER":
            data = await prisma.supplier.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    mobile: true,
                    company: true,
                    rating: true,
                    role: true,
                    type: true,
                    online_contact: true,
                    address: true,
                    avatar: {
                        select: {
                            image_url: true,
                            public_id: true,
                        },
                    },
                },
                take: 20,
                skip,
                orderBy: {
                    name: "asc",
                },
            });
            break;

        case "DOCTOR":
            // Add doctor logic here
            break;

        case "EMPLOYEE":
            data = await prisma.employee.findMany({
                select: {
                    id: true,
                    name: true,
                    email: true,
                    mobile: true,
                    rating: true,
                    role: true,
                    salary: true,
                    online_contact: true,
                    address: true,
                    avatar: {
                        select: {
                            image_url: true,
                            public_id: true,
                        },
                    },
                },
                take: 20,
                skip,
                orderBy: {
                    name: "asc",
                },
            });
            break;

        case "ADMIN":
            // Add admin logic here
            break;

        case "BATCH":
            data = await prisma.batch.findMany({
                select: {
                    id: true,
                    batch_name: true,
                    breed: true,
                    start_date: true,
                    expected_end_date: true,
                    supplier: {
                        select: {
                            name: true,
                            id: true,
                            avatar: {
                                select: {
                                    image_url: true,
                                    public_id: true,
                                },
                            },
                        },
                    },
                    is_from_registerd_supplier: true,
                    house_no: true,
                    received_quantity: true,
                },
            });
            break;

        case "PHERMASIST": // probably "PHARMACIST"
            // Add pharmacist logic here
            break;

        default:
            throwError({
                message: "Invalid category type",
                statusCode: 400,
            });
    }

    if (!data || data.length === 0) {
        throwError({
            message: "No data found",
            statusCode: 404,
            data: { is_found: false },
        });
    }

    console.log(data);

    const formatted = data.map((item) => ({
        id: item.id,
        name: item.name,
        company: item.company,
        email: item.email,
        mobile: item.mobile,
        role: item.role,
        type: item.type,
        rating: item.rating,
        avatar: item.avatar || null,
        online_contact: item.online_contact,
        address: item.address,
    }));

    return sendSuccessResponse({
        response: res,
        data: data,
        message: `Found ${category.toLowerCase()} list`,
    });
}
