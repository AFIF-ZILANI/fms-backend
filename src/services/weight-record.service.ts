import prisma from "@lib/db";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateWeightRecordInput,
    ListWeightRecordsQuery,
} from "@validators/weight-record.validator";

export const WeightRecordService = {
    async getAll(query: ListWeightRecordsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [records, total] = await Promise.all([
            prisma.weightRecords.findMany({
                where,
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.weightRecords.count({ where }),
        ]);
        return { records, meta: buildMeta(total, query) };
    },

    // @@unique([batch_id, house_id, date]) -- a second sample logged for the
    // same batch+house+day is a conflict, not silently overwritten.
    async create(data: CreateWeightRecordInput) {
        try {
            return await prisma.weightRecords.create({
                data: {
                    house_id: data.house_id,
                    average_wt_grams: data.average_wt_grams,
                    sample_size: data.sample_size,
                    date: data.date,
                    measured_by_id: data.measured_by_id,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                    ...(data.batch_id !== undefined && { batch_id: data.batch_id }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
