import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { BindStockUnitInput, ListStockUnitsQuery } from "@validators/stock-unit.validator";

const generateCode = () => `SU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

export const StockUnitService = {
    async getAll(query: ListStockUnitsQuery) {
        const where = {
            ...(query.status !== undefined && { status: query.status }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [stockUnits, total] = await Promise.all([
            prisma.stockUnit.findMany({
                where,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockUnit.count({ where }),
        ]);
        return { stockUnits, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        return unit;
    },

    async getByCode(code: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { code } });
        if (!unit) throw AppError.notFound("StockUnit");
        return unit;
    },

    /** Prints N blank codes (status UNASSIGNED, unbound) ahead of need. */
    async provision(count: number) {
        const codes = Array.from({ length: count }, generateCode);
        await prisma.stockUnit.createMany({ data: codes.map((code) => ({ code })) });
        return prisma.stockUnit.findMany({
            where: { code: { in: codes } },
            orderBy: { created_at: "desc" },
        });
    },

    /** Binds a blank code to a purchase lot -- UNASSIGNED -> IN_STOCK. */
    async bind(id: string, input: BindStockUnitInput) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status !== "UNASSIGNED") {
            throw AppError.conflict(`StockUnit is already ${unit.status.toLowerCase()}`);
        }

        try {
            return await prisma.stockUnit.update({
                where: { id },
                data: {
                    purchase_item_id: input.purchase_item_id,
                    status: "IN_STOCK",
                    bound_at: new Date(),
                    ...(input.initial_quantity !== undefined && {
                        initial_quantity: input.initial_quantity,
                        remaining_quantity: input.initial_quantity,
                    }),
                    ...(input.bound_by_id !== undefined && { bound_by_id: input.bound_by_id }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async relocate(id: string, house_id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        try {
            return await prisma.stockUnit.update({ where: { id }, data: { house_id } });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async dispose(id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status === "DISPOSED") throw AppError.conflict("StockUnit is already disposed");
        return prisma.stockUnit.update({ where: { id }, data: { status: "DISPOSED" } });
    },
};
