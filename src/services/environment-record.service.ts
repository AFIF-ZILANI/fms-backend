import prisma from "@lib/db";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateEnvironmentRecordInput,
    ListEnvironmentRecordsQuery,
} from "@validators/environment-record.validator";

export const EnvironmentRecordService = {
    async getAll(query: ListEnvironmentRecordsQuery) {
        const where = {
            ...(query.batch_id !== undefined && { batch_id: query.batch_id }),
            ...(query.house_id !== undefined && { house_id: query.house_id }),
        };
        const [records, total] = await Promise.all([
            prisma.environmentRecords.findMany({
                where,
                orderBy: { recorded_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.environmentRecords.count({ where }),
        ]);
        return { records, meta: buildMeta(total, query) };
    },

    async create(data: CreateEnvironmentRecordInput) {
        try {
            return await prisma.environmentRecords.create({
                data: {
                    ...data,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
