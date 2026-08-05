import prisma from "@lib/db";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListBalancesQuery } from "@validators/batch-house-balance.validator";

// Read-only -- BatchHouseBalance is only ever mutated by
// BatchService.create, BatchHouseAllocationService.create, and
// MortalityLogService.create (see comment on the model itself).
export const BatchHouseBalanceService = {
    async getAll(query: ListBalancesQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [balances, total] = await Promise.all([
            prisma.batchHouseBalance.findMany({
                where,
                include: { batch: true, house: true },
                orderBy: { updated_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.batchHouseBalance.count({ where }),
        ]);
        return { balances, meta: buildMeta(total, query) };
    },
};
