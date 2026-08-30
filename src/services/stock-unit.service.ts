import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    BindStockUnitInput,
    ListStockUnitsQuery,
    SetStockUnitStatusInput,
} from "@validators/stock-unit.validator";

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
            // Search by unit id (the QR payload) -- full scanned id or a fragment.
            ...(query.q !== undefined && { id: { contains: query.q, mode: "insensitive" as const } }),
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

    /** Free status set for the manual "change status" action -- no transition guards (unlike
     *  bind/dispose), the operator picks the target status directly. */
    async setStatus(id: string, status: SetStockUnitStatusInput["status"]) {
        const unit = await prisma.stockUnit.findUnique({ where: { id } });
        if (!unit) throw AppError.notFound("StockUnit");
        return prisma.stockUnit.update({ where: { id }, data: { status } });
    },

    /** Hard delete -- for mistakenly-provisioned/bound codes. Its house-allocation event log is
     *  purged with it (safe: just move history). A unit that's been consumed from or turned into an
     *  asset is real data, not a mistake, so those are refused rather than silently orphaned. */
    async remove(id: string) {
        const unit = await prisma.stockUnit.findUnique({
            where: { id },
            include: { _count: { select: { consumptions: true } }, asset: true },
        });
        if (!unit) throw AppError.notFound("StockUnit");
        if (unit._count.consumptions > 0 || unit.asset) {
            throw AppError.conflict(
                "Cannot delete a unit with consumption history or a linked asset",
            );
        }
        await prisma.$transaction([
            prisma.stockHouseAllocation.deleteMany({ where: { stock_unit_id: id } }),
            prisma.stockUnit.delete({ where: { id } }),
        ]);
    },
};
