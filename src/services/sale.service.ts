import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateSaleInput, ListSalesQuery } from "@validators/sale.validator";

const include = { items: { include: { item: true } }, customer: true } as const;

// Sale/SaleItem are append-only, same as Purchase/PurchaseItem -- no update.
export const SaleService = {
    async getAll(query: ListSalesQuery) {
        const where = {
            ...(query.customer_id !== undefined && { customer_id: query.customer_id }),
            ...((query.date_from !== undefined || query.date_to !== undefined) && {
                sale_date: {
                    ...(query.date_from !== undefined && { gte: query.date_from }),
                    ...(query.date_to !== undefined && { lte: query.date_to }),
                },
            }),
            ...(query.item_category !== undefined && {
                items: { some: { item: { category: query.item_category } } },
            }),
        };
        const [sales, total] = await Promise.all([
            prisma.sale.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.sale.count({ where }),
        ]);
        return { sales, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const sale = await prisma.sale.findUnique({ where: { id }, include });
        if (!sale) throw AppError.notFound("Sale");
        return sale;
    },

    async create(data: CreateSaleInput) {
        const itemsWithTotals = data.items.map((item) => ({
            ...item,
            total_price: new Prisma.Decimal(item.quantity).times(item.unit_price),
        }));
        const total = itemsWithTotals.reduce(
            (sum, item) => sum.plus(item.total_price),
            new Prisma.Decimal(0),
        );
        const paid_amount = new Prisma.Decimal(data.paid_amount);
        const due_amount = total.minus(paid_amount);
        if (due_amount.isNegative()) {
            throw AppError.badRequest("paid_amount cannot exceed the sale total");
        }

        try {
            return await prisma.$transaction(async (tx) => {
                const sale = await tx.sale.create({
                    data: {
                        sale_date: data.sale_date,
                        total,
                        paid_amount,
                        due_amount,
                        recorded_by_id: data.recorded_by_id,
                        ...(data.customer_id !== undefined && { customer_id: data.customer_id }),
                    },
                });

                await tx.saleItem.createMany({
                    data: itemsWithTotals.map((item) => ({
                        sale_id: sale.id,
                        item_id: item.item_id,
                        quantity: item.quantity,
                        unit: item.unit,
                        unit_price: item.unit_price,
                        total_price: item.total_price,
                    })),
                });

                return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
