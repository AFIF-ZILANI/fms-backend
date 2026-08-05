import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateAllocationInput,
    ListAllocationsQuery,
} from "@validators/batch-house-allocation.validator";

export const BatchHouseAllocationService = {
    async getAll(query: ListAllocationsQuery) {
        const where = { ...(query.batch_id !== undefined && { batch_id: query.batch_id }) };
        const [allocations, total] = await Promise.all([
            prisma.batchHouseAllocation.findMany({
                where,
                orderBy: { occurred_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.batchHouseAllocation.count({ where }),
        ]);
        return { allocations, meta: buildMeta(total, query) };
    },

    /** TRANSFER (both houses set) or ADJUSTMENT (either set, direction is
     * whichever field is set) -- decrement from_house's balance, increment
     * to_house's, in one transaction with the allocation row itself. */
    async create(data: CreateAllocationInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const batch = await tx.batches.findUnique({ where: { id: data.batch_id } });
                if (!batch) throw AppError.notFound("Batch");
                if (batch.status !== "RUNNING") throw AppError.conflict("Batch is not RUNNING");

                const allocation = await tx.batchHouseAllocation.create({
                    data: {
                        batch_id: data.batch_id,
                        quantity: data.quantity,
                        reason: data.reason,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.from_house_id !== undefined && {
                            from_house_id: data.from_house_id,
                        }),
                        ...(data.to_house_id !== undefined && { to_house_id: data.to_house_id }),
                    },
                });

                if (data.from_house_id !== undefined) {
                    const fromHouseId = data.from_house_id;
                    const balance = await tx.batchHouseBalance.findUnique({
                        where: {
                            batch_id_house_id: { batch_id: data.batch_id, house_id: fromHouseId },
                        },
                    });
                    if (!balance || balance.quantity < data.quantity) {
                        throw AppError.conflict("Insufficient birds in source house for this move");
                    }
                    await tx.batchHouseBalance.update({
                        where: { id: balance.id },
                        data: { quantity: { decrement: data.quantity } },
                    });
                }

                if (data.to_house_id !== undefined) {
                    const toHouseId = data.to_house_id;
                    await tx.batchHouseBalance.upsert({
                        where: {
                            batch_id_house_id: { batch_id: data.batch_id, house_id: toHouseId },
                        },
                        create: {
                            batch_id: data.batch_id,
                            house_id: toHouseId,
                            quantity: data.quantity,
                        },
                        update: { quantity: { increment: data.quantity } },
                    });
                }

                return allocation;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
