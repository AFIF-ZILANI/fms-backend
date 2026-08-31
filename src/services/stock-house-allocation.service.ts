import prisma from "@lib/db";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListStockHouseAllocationsQuery } from "@validators/stock-house-allocation.validator";

// Read-only ledger of every StockUnit house move -- rows are written by
// StockUnitService.relocate(), never posted directly.
export const StockHouseAllocationService = {
    async getAll(query: ListStockHouseAllocationsQuery) {
        const where = {
            ...(query.house_id !== undefined && { house_id: query.house_id }),
            ...(query.type !== undefined && { type: query.type }),
            ...(query.stock_unit_id !== undefined && { stock_unit_id: query.stock_unit_id }),
        };
        const [entries, total] = await Promise.all([
            prisma.stockHouseAllocation.findMany({
                where,
                include: {
                    house: true,
                    stock_unit: { include: { purchase_item: { include: { item: true } } } },
                },
                orderBy: { occurred_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.stockHouseAllocation.count({ where }),
        ]);
        return { entries, meta: buildMeta(total, query) };
    },
};
