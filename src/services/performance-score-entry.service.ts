import prisma from "@lib/db";
import { handlePrismaWriteError } from "@lib/prisma-errors";
import { toSkipTake, buildMeta } from "@lib/pagination";
import { FIXED_CRITERION_POINTS, type FixedCriterion } from "@lib/performance-criteria";
import type {
    CreateScoreEntryInput,
    ListScoreEntriesQuery,
} from "@validators/performance-score-entry.validator";

export const PerformanceScoreEntryService = {
    async getAll(query: ListScoreEntriesQuery) {
        const dateRange = {
            ...(query.date_from !== undefined && { gte: query.date_from }),
            ...(query.date_to !== undefined && { lte: query.date_to }),
        };
        const where = {
            ...(query.employee_id !== undefined && { employee_id: query.employee_id }),
            ...(Object.keys(dateRange).length > 0 && { date: dateRange }),
        };
        const [entries, total] = await Promise.all([
            prisma.performanceScoreEntry.findMany({
                where,
                // The field app's score history names who gave each entry. Joining
                // client-side isn't an option: given_by_id is any Profile, so an
                // Admin scoring a Manager would resolve to no name at all.
                include: { given_by: { select: { id: true, name: true, role: true } } },
                orderBy: { date: "desc" },
                ...toSkipTake(query),
            }),
            prisma.performanceScoreEntry.count({ where }),
        ]);
        return { entries, meta: buildMeta(total, query) };
    },

    /** Snapshots the criterion's fixed point value at entry time -- the
     * client only controls the actual point count for the OTHER escape
     * hatch (validator already bounds it to ±1-5). */
    async create(data: CreateScoreEntryInput) {
        const points =
            data.criterion === "OTHER"
                ? (data.points as number)
                : FIXED_CRITERION_POINTS[data.criterion as FixedCriterion];

        try {
            return await prisma.performanceScoreEntry.create({
                data: {
                    employee_id: data.employee_id,
                    given_by_id: data.given_by_id,
                    criterion: data.criterion,
                    points,
                    reason: data.reason,
                    idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
                    ...(data.date !== undefined && { date: data.date }),
                },
            });
        } catch (err) {
            return handlePrismaWriteError(err);
        }
    },
};
