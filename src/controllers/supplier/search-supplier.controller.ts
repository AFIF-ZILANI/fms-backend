import type { Request, Response } from "express";
import { prisma } from "@/utils/db";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { throwError } from "@/utils/error";

export async function findSupplier(req: Request, res: Response) {
    const search = req.query.search?.toString().trim() || "";

    console.log(search)
    const suppliers = await prisma.supplier.findMany({
        where: search
            ? {
                  name: {
                      contains: search,
                      mode: "insensitive",
                  },
              }
            : {},
        select: {
            id: true,
            name: true,
            company: true,
            avatar: {
                select: {
                    image_url: true,
                },
            },
        },
        take: 10, // optional, limit results
        orderBy: {
            name: "asc",
        },
    });

    console.log(suppliers)
    if (!suppliers.length) {
        throwError({
            message: "not found",
            statusCode: 400,
            data: { is_found_suppliers: false },
        });
    }

    const formatted = suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        company: s.company,
        avatar: s.avatar?.image_url || null,
    }));
    return sendSuccessResponse({
        response: res,
        data: formatted,
        message: "Fuound suppliers list",
    });
}
