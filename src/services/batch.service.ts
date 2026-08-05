import prisma from "@lib/db";
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
     * force:true. BirdSale (Phase 9) doesn't exist yet to reconcile
     * against, so force is the escape hatch until then; AssetDepreciation
     * computation stays out of scope here -- that's Phase 11. */
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

        return prisma.batches.update({
            where: { id },
            data: { status: data.status, actual_end_date: new Date() },
            include,
        });
    },
};
