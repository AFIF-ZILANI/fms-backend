import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { BindStockUnitInput, ListStockUnitsQuery } from "@validators/stock-unit.validator";

// Latest allocation = current location. Included on reads so callers still get "where is it".
const withRelations = {
    purchase_item: { include: { item: true } },
    houseAllocations: { orderBy: { occurred_at: "desc" as const }, take: 1, include: { house: true } },
    asset: true,
};

export const StockUnitService = {
    async getAll(query: ListStockUnitsQuery) {
        const where = {
            ...(query.status !== undefined && { status: query.status }),
            // ponytail: matches "ever allocated to this house", not "currently there". Add
            // latest-allocation filtering only if the UI needs strict current-location filtering.
            ...(query.house_id !== undefined && {
                houseAllocations: { some: { house_id: query.house_id } },
            }),
            ...(query.category !== undefined && {
                purchase_item: { item: { category: query.category } },
            }),
        };
        const [stockUnits, total] = await Promise.all([
            prisma.stockUnit.findMany({
                where,
                include: withRelations,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockUnit.count({ where }),
        ]);
        return { stockUnits, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id }, include: withRelations });
        if (!unit) throw AppError.notFound("StockUnit");
        return unit;
    },

    /** Creates N blank units (status UNASSIGNED, unbound) ahead of need. The row id IS the QR payload. */
    async provision(count: number) {
        return prisma.stockUnit.createManyAndReturn({
            data: Array.from({ length: count }, () => ({})),
        });
    },

    /** Binds a blank unit to a purchase lot -- UNASSIGNED -> IN_STOCK. */
    async bind(id: string, input: BindStockUnitInput) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit.status !== "UNASSIGNED") {
            throw AppError.conflict(`StockUnit is already ${unit.status.toLowerCase()}`);
        }
        try {
            return await prisma.stockUnit.update({
                where: { id },
                data: { purchase_item_id: input.purchase_item_id, status: "IN_STOCK", bound_at: new Date() },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Records a physical move as a StockHouseAllocation event (WH->House, or A->B->C). */
    async relocate(id: string, house_id: string, idempotency_key: string) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        try {
            return await prisma.stockHouseAllocation.create({
                data: { stock_unit_id: id, house_id, idempotency_key },
            });
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
