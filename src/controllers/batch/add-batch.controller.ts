import { BirdBreed, type IBatch } from "@/types";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { generateBatchId, getLastBatchNumber } from "@/utils/batch-utils";
import { prisma } from "@/utils/db";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";

export async function AddBatch(req: Request, res: Response) {
    const body = req.body;
    const {
        breed,
        expected_end_date,
        received_quantity,
        start_date,
        supplier_id,
        house_no,
    }: IBatch = body;

    console.log();
    if (
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

    if (!Object.values(BirdBreed).includes(breed)) {
        throwError({ message: "invalid breed", statusCode: 400 });
    }

    const s_date = new Date(start_date);
    const e_date = new Date(expected_end_date);

    // Check if either date is invalid
    if (isNaN(s_date.getTime()) || isNaN(e_date.getTime())) {
        throwError({ message: "Invalid date time", statusCode: 400 });
    }

    // Optional: check logical order
    if (e_date <= s_date) {
        throwError({
            message: "expected_end_date must be after start_date",
            statusCode: 400,
        });
    }

    if (supplier_id) {
        const existSupplier = await prisma.supplier.findUnique({
            where: {
                id: supplier_id,
            },
        });

        if (!existSupplier) {
            throwError({ message: "Invalid Supplier id", statusCode: 400 });
        }
    }

    // currnly the farmCode and sectorCode is hard coded
    const farmCode = "F01";
    const sectorCode = "POU";
    const productCode = breed.slice(0, 3);
    console.log(productCode)
    const lastBatchNo = await getLastBatchNumber(
        farmCode,
        sectorCode,
        productCode
    );
    const batch_id = generateBatchId(
        farmCode,
        sectorCode,
        productCode,
        lastBatchNo
    );
    const newBatch = await prisma.batch.create({
        data: {
            batch_id,
            farm_code: farmCode,
            sector_code: sectorCode,
            product_code: productCode,
            breed,
            start_date: s_date,
            expected_end_date: e_date,
            supplier: supplier_id
                ? { connect: { id: supplier_id } }
                : undefined,
            is_from_registerd_supplier: !!supplier_id,
            house_no,
            received_quantity,
        },
    });

    if (!newBatch) {
        throwError({ message: "Failed to create Batch", statusCode: 500 });
    }

    return sendSuccessResponse({
        response: res,
        message: "Batch created successfully!",
    });
}
