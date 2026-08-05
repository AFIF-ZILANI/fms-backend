import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type {
    CreateFeedingProgramInput,
    ListFeedingProgramsQuery,
} from "@validators/batch-feeding-program.validator";

export const BatchFeedingProgramService = {
    async getAll(query: ListFeedingProgramsQuery) {
        const where = { ...(query.batch_id !== undefined && { batch_id: query.batch_id }) };
        const [programs, total] = await Promise.all([
            prisma.batchFeedingProgram.findMany({
                where,
                include: { item: true },
                orderBy: { start_day: "asc" },
                ...toSkipTake(query),
            }),
            prisma.batchFeedingProgram.count({ where }),
        ]);
        return { programs, meta: buildMeta(total, query) };
    },

    async create(data: CreateFeedingProgramInput) {
        try {
            return await prisma.batchFeedingProgram.create({
                data: {
                    batch_id: data.batch_id,
                    feed_type: data.feed_type,
                    item_id: data.item_id,
                    start_day: data.start_day,
                    ...(data.end_day !== undefined && { end_day: data.end_day }),
                },
                include: { item: true },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },

    /** Only end_day is editable -- closing out a feed phase early/late.
     * Everything else about a program is fixed at creation. */
    async setEndDay(id: string, end_day: number) {
        const program = await prisma.batchFeedingProgram.findUnique({ where: { id } });
        if (!program) throw AppError.notFound("BatchFeedingProgram");
        return prisma.batchFeedingProgram.update({ where: { id }, data: { end_day } });
    },
};
