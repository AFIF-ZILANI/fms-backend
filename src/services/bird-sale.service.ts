import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateBirdSaleInput, ListBirdSalesQuery } from "@validators/bird-sale.validator";

export const BirdSaleService = {
    async getAll(query: ListBirdSalesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.customer_id !== undefined && { customer_id: query.customer_id }),
        };
        const [birdSales, total] = await Promise.all([
            prisma.birdSale.findMany({
                where,
                orderBy: { sale_date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.birdSale.count({ where }),
        ]);
        return { birdSales, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const birdSale = await prisma.birdSale.findUnique({ where: { id } });
        if (!birdSale) throw AppError.notFound("BirdSale");
        return birdSale;
    },

    /** total_amount/due_amount are the only server-computed money fields --
     * net_weight * price_per_kg is unambiguous. Everything regional
     * (dholta/katha) stays exactly as the client sends it. Decrements
     * BatchHouseBalance in the same transaction -- the third of the "only
     * three things allowed to touch that balance" (batch-management-design.md). */
    async create(data: CreateBirdSaleInput) {
        const total_amount = new Prisma.Decimal(data.net_weight).times(data.price_per_kg);
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        const due_amount = total_amount.minus(paid_amount);
        if (due_amount.isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the computed total_amount");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const balance = await tx.batchHouseBalance.findUnique({
                    where: {
                        batch_id_house_id: { batch_id: data.batch_id, house_id: data.house_id },
                    },
                });
                if (!balance || balance.quantity < data.birds_count) {
                    throw AppError.conflict("Sale quantity exceeds live birds in this house");
                }

                const birdSale = await tx.birdSale.create({
                    data: {
                        batch_id: data.batch_id,
                        house_id: data.house_id,
                        sale_date: data.sale_date,
                        grade: data.grade,
                        birds_count: data.birds_count,
                        dholta_in_g: data.dholta_in_g,
                        total_katha: data.total_katha,
                        total_weight: data.total_weight,
                        net_weight: data.net_weight,
                        price_per_kg: data.price_per_kg,
                        total_amount,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
                        ...(data.male_count !== undefined && { male_count: data.male_count }),
                        ...(data.female_count !== undefined && { female_count: data.female_count }),
                        ...(data.avg_wt_per_katha_kg !== undefined && {
                            avg_wt_per_katha_kg: data.avg_wt_per_katha_kg,
                        }),
                        ...(data.avg_weight_g !== undefined && { avg_weight_g: data.avg_weight_g }),
                    },
                });

                await tx.batchHouseBalance.update({
                    where: { id: balance.id },
                    data: { quantity: { decrement: data.birds_count } },
                });

                return birdSale;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
