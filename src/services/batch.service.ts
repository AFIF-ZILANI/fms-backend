import prisma from "@lib/db";
import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateBatchInput,
    UpdateBatchInput,
    CloseBatchInput,
    ListBatchesQuery,
} from "@validators/batch.validator";

const include = { houseBalances: { include: { house: true } } } as const;

export const BatchService = {
    async getAll(query: ListBatchesQuery) {
        const where = {
            ...(query.status !== undefined && { status: query.status }),
            ...(query.breed !== undefined && { breed: query.breed }),
            ...(query.phase !== undefined && { phase: query.phase }),
        };
        const [batches, total] = await Promise.all([
            prisma.batches.findMany({
                where,
                include,
                orderBy: { created_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.batches.count({ where }),
        ]);
        return { batches, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const batch = await prisma.batches.findUnique({ where: { id }, include });
        if (!batch) throw AppError.notFound("Batch");
        return batch;
    },

    /** Chicks fund a batch financially and physically at the same moment
     * (system-design-arc.md "chicks arrive" flow) -- creates the Batch, the
     * matching INITIAL BatchHouseAllocation, and the starting
     * BatchHouseBalance in one transaction. */
    async create(data: CreateBatchInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const batch = await tx.batches.create({
                    data: {
                        batch_code: data.batch_code,
                        breed: data.breed,
                        expected_selling_date: data.expected_selling_date,
                        initial_chick_count: data.initial_chick_count,
                        init_chicks_avg_wt: data.init_chicks_avg_wt,
                        ...(data.starting_date !== undefined && {
                            starting_date: data.starting_date,
                        }),
                    },
                });

                await tx.batchHouseAllocation.create({
                    data: {
                        batch_id: batch.id,
                        to_house_id: data.house_id,
                        quantity: data.initial_chick_count,
                        reason: "INITIAL",
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: crypto.randomUUID(),
                    },
                });

                await tx.batchHouseBalance.create({
                    data: {
                        batch_id: batch.id,
                        house_id: data.house_id,
                        quantity: data.initial_chick_count,
                    },
                });

                return tx.batches.findUniqueOrThrow({ where: { id: batch.id }, include });
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    async update(id: string, data: UpdateBatchInput) {
        const batch = await prisma.batches.findUnique({ where: { id } });
        if (!batch) throw AppError.notFound("Batch");
        if (batch.status !== "RUNNING")
            throw AppError.conflict("Cannot edit a batch that isn't RUNNING");

        const { batch_code, breed, phase, expected_selling_date } = data;
        if (!batch_code && !breed && !phase && !expected_selling_date) {
            throw AppError.badRequest("No update fields provided");
        }

        try {
            return await prisma.batches.update({
                where: { id },
                data: {
                    ...(batch_code && { batch_code }),
                    ...(breed && { breed }),
                    ...(phase && { phase }),
                    ...(expected_selling_date && { expected_selling_date }),
                },
                include,
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Manual close, per the confirmed design decision (FEATURES.md §2.2) --
     * requires all birds accounted for (balances sum to zero) unless
     * force:true.
     *
     * Also fires the AssetDepreciation trigger deferred since Phase 5/6:
     * an Asset has no direct link to a Batch, but Consumption does (batch_id
     * + stock_unit_id together), so "which assets did this batch use" is
     * "which Assets' StockUnits appear in this batch's Consumption rows."
     * For each ACTIVE one, amount = purchase_cost / useful_life_batches
     * (the formula named in inventory-tracking-design.md), written via
     * upsert so closing is safe to retry without double-computing. */
    async close(id: string, data: CloseBatchInput) {
        const batch = await prisma.batches.findUnique({
            where: { id },
            include: { houseBalances: true },
        });
        if (!batch) throw AppError.notFound("Batch");
        if (batch.status !== "RUNNING") throw AppError.conflict("Batch is not RUNNING");

        const remaining = batch.houseBalances.reduce((sum, b) => sum + b.quantity, 0);
        if (remaining !== 0 && !data.force) {
            throw AppError.conflict(
                `Batch still has ${remaining} live birds allocated -- pass force:true to close anyway`,
            );
        }

        return prisma.$transaction(async (tx) => {
            // force:true can close with birds still on the books -- a CLOSED batch has none live,
            // so zero the balances too or its houses stay "occupied" forever (see model comment).
            if (remaining !== 0) {
                await tx.batchHouseBalance.updateMany({ where: { batch_id: id }, data: { quantity: 0 } });
            }

            const closed = await tx.batches.update({
                where: { id },
                data: { status: data.status, actual_end_date: new Date() },
                include,
            });

            const usedStockUnits = await tx.consumption.findMany({
                where: { batch_id: id, stock_unit_id: { not: null } },
                select: { stock_unit_id: true },
                distinct: ["stock_unit_id"],
            });
            const stockUnitIds = usedStockUnits
                .map((c) => c.stock_unit_id)
                .filter((v): v is string => v !== null);

            if (stockUnitIds.length > 0) {
                const assets = await tx.asset.findMany({
                    where: { stock_unit_id: { in: stockUnitIds }, status: "ACTIVE" },
                });
                for (const asset of assets) {
                    const amount = new Prisma.Decimal(asset.purchase_cost).dividedBy(
                        asset.useful_life_batches,
                    );
                    await tx.assetDepreciation.upsert({
                        where: { asset_id_batch_id: { asset_id: asset.id, batch_id: id } },
                        create: { asset_id: asset.id, batch_id: id, amount },
                        update: {},
                    });
                }
            }

            return closed;
        });
    },
};
