import prisma from "@lib/db";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListAssetDepreciationsQuery } from "@validators/asset-depreciation.validator";

// Read-only -- rows are written exclusively by BatchService.close()'s
// depreciation trigger (see batch.service.ts), never posted directly.
export const AssetDepreciationService = {
    async getAll(query: ListAssetDepreciationsQuery) {
        const where = {
            ...(query.asset_id !== undefined && { asset_id: query.asset_id }),
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
        };
        const [depreciations, total] = await Promise.all([
            prisma.assetDepreciation.findMany({
                where,
                include: { asset: true },
                orderBy: { computed_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.assetDepreciation.count({ where }),
        ]);
        return { depreciations, meta: buildMeta(total, query) };
    },
};
