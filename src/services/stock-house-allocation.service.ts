import prisma from "@lib/db";
import type {
    StockActivitySummary,
    StockActivitySummaryQuery,
} from "@validators/stock-activity.validator";
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
            ...(query.item_id !== undefined && {
                stock_unit: { purchase_item: { item_id: query.item_id } },
            }),
            ...((query.occurred_from !== undefined || query.occurred_to !== undefined) && {
                occurred_at: {
                    ...(query.occurred_from !== undefined && { gte: query.occurred_from }),
                    ...(query.occurred_to !== undefined && { lte: query.occurred_to }),
                },
            }),
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

    /** Units moved into a house (an allocation, or a move from another house): how many in all, today,
     *  this week, across how many items, and when the last one landed. */
    async summary(query: StockActivitySummaryQuery): Promise<StockActivitySummary> {
        const [row] = await prisma.$queryRaw<
            { total: number; today: number; week: number; items: number; last_at: Date | null }[]
        >`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE a.occurred_at >= ${query.today_from})::int AS today,
                   COUNT(*) FILTER (WHERE a.occurred_at >= ${query.week_from})::int AS week,
                   COUNT(DISTINCT pi.item_id)::int AS items,
                   MAX(a.occurred_at) AS last_at
            FROM "StockHouseAllocation" a
            JOIN "StockUnit" su ON su.id = a.stock_unit_id
            LEFT JOIN "PurchaseItem" pi ON pi.id = su.purchase_item_id
            WHERE a.house_id = ${query.house_id}`;
        return row!;
    },
};
