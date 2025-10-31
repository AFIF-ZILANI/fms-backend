import { BirdBreed, type IBatch } from "@/types";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { prisma } from "@/utils/db";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";

export async function AddBatch(req: Request, res: Response) {
    const body = req.body;
    const {
        batch_name,
        breed,
        expected_end_date,
        received_quantity,
        start_date,
        supplier_id,
        house_no,
        is_from_registerd_supplier,
    }: IBatch = body;

    if (
        !batch_name ||
        !breed ||
        !expected_end_date ||
        !received_quantity ||
        !start_date ||
        !house_no
    ) {
        throwError({
            message: "Some requierd fields are missing",
            statusCode: 400,
        });
    }

    if (!supplier_id && is_from_registerd_supplier) {
        throwError({
            message:
                "Supplier id is missing or incorrect 'is_from_registerd_supplier' field",
        });
    }

    if (!Object.values(BirdBreed).includes(breed)) {
        throwError({ message: "invalid breed", statusCode: 400 });
    }

    const s_date = new Date(start_date);
    const e_date = new Date(expected_end_date);
    if (!s_date || e_date) {
        throwError({ message: "invalid Date time", statusCode: 400 });
    }

    if (supplier_id && !is_from_registerd_supplier) {
        const existSupplier = await prisma.supplier.findMany({
            where: {
                id: supplier_id,
            },
        });

        if (!existSupplier) {
            throwError({ message: "Invalid Supplier id", statusCode: 400 });
        }
    }

    const newBatch = await prisma.batch.create({
        data: {
            batch_name,
            breed,
            start_date,
            expected_end_date,
            supplier: supplier_id
                ? { connect: { id: supplier_id } }
                : undefined,
            is_from_registerd_supplier,
            house_no,
            received_quantity,
        },
    });

    if (!newBatch) {
        throwError({ message: "Faild to create Batch", statusCode: 500 });
    }

    return sendSuccessResponse({
        response: res,
        message: "Batch created successfully!",
    });
}
