import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateMortalityLogInput,
    ListMortalityLogsQuery,
} from "@validators/mortality-log.validator";

export const MortalityLogService = {
    async getAll(query: ListMortalityLogsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [logs, total] = await Promise.all([
            prisma.mortalityLog.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.mortalityLog.count({ where }),
        ]);
        return { logs, meta: buildMeta(total, query) };
    },

    /** Decrements BatchHouseBalance in the same transaction as the log row
     * -- one of only three things allowed to change that balance. */
    async create(data: CreateMortalityLogInput) {
        try {
            return await prisma.$transaction(async (tx) => {
                const balance = await tx.batchHouseBalance.findUnique({
                    where: {
                        batch_id_house_id: { batch_id: data.batch_id, house_id: data.house_id },
                    },
                });
                if (!balance || balance.quantity < data.count_died) {
                    throw AppError.conflict("Mortality count exceeds live birds in this house");
                }

                const log = await tx.mortalityLog.create({
                    data: {
                        batch_id: data.batch_id,
                        house_id: data.house_id,
                        count_died: data.count_died,
                        date: data.date,
                        recorded_by_id: data.recorded_by_id,
                        idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                        ...(data.cause_note !== undefined && { cause_note: data.cause_note }),
                    },
                });

                await tx.batchHouseBalance.update({
                    where: { id: balance.id },
                    data: { quantity: { decrement: data.count_died } },
                });

                return log;
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
