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
            include: { stock_unit: true },
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

    async setStatus(id: string, status: "ACTIVE" | "RETIRED" | "DISPOSED") {
        const asset = await prisma.asset.findUnique({ where: { id } });
        if (!asset) throw AppError.notFound("Asset");
        return prisma.asset.update({ where: { id }, data: { status } });
    },
};
