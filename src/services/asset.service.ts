import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { CreateAssetInput, ListAssetsQuery } from "@validators/asset.validator";

export const AssetService = {
    async getAll(query: ListAssetsQuery) {
        const where = { ...(query.status !== undefined && { status: query.status }) };
        const [assets, total] = await Promise.all([
            prisma.asset.findMany({
                where,
                include: { depreciations: true },
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.asset.count({ where }),
        ]);
        return { assets, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const asset = await prisma.asset.findUnique({
            where: { id },
            include: {
                stock_unit: true,
                depreciations: { include: { batch: true } },
            },
        });
        if (!asset) throw AppError.notFound("Asset");
        return asset;
    },

    async create(data: CreateAssetInput) {
        try {
            return await prisma.asset.create({ data, include: { stock_unit: true } });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /**
     * Hard delete -- a mis-created asset only (wrong StockUnit, duplicate). An asset
     * that has been depreciated against a batch carries cost history, so it is
     * RETIRED/DISPOSED via setStatus instead, keeping AssetDepreciation resolvable.
     * The unit itself is untouched either way: deleting the Asset frees its
     * stock_unit_id (@unique) so the same unit can be re-registered, and unblocks
     * StockUnitService.remove, which refuses while a linked asset exists.
     */
    async remove(id: string) {
        const asset = await prisma.asset.findUnique({
            where: { id },
            select: { _count: { select: { depreciations: true } } },
        });
        if (!asset) throw AppError.notFound("Asset");
        if (asset._count.depreciations > 0) {
            throw AppError.conflict(
                "Asset has depreciation history and cannot be deleted. Retire it instead.",
            );
        }

        return prisma.asset.delete({ where: { id } });
    },

    async setStatus(id: string, status: "ACTIVE" | "RETIRED" | "DISPOSED") {
        const asset = await prisma.asset.findUnique({ where: { id } });
        if (!asset) throw AppError.notFound("Asset");
        return prisma.asset.update({ where: { id }, data: { status } });
    },
};
