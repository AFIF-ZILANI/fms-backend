import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListAuditLogsQuery } from "@validators/audit-log.validator";

/**
 * Read side only -- population is deliberately not built here. Writing
 * AuditLog rows on every mutable-table update needs to know who made the
 * change, and there's no request-scoped actor identity until Phase 15
 * (Auth) exists. Retrofitting manual audit-write calls into the ~15
 * already-merged services now would give inconsistent coverage (some
 * services get it, others don't), which is worse than the current
 * consistent "not yet populated" state. This endpoint is ready the moment
 * Phase 15 starts writing to it.
 */
export const AuditLogService = {
    async getAll(query: ListAuditLogsQuery) {
        const where = {
            ...(query.table_name !== undefined && { table_name: query.table_name }),
            ...(query.record_id !== undefined && { record_id: query.record_id }),
            ...(query.changed_by_id !== undefined && { changed_by_id: query.changed_by_id }),
            ...(query.action !== undefined && { action: query.action }),
            ...((query.from !== undefined || query.to !== undefined) && {
                occurred_at: {
                    ...(query.from !== undefined && { gte: query.from }),
                    ...(query.to !== undefined && { lte: query.to }),
                },
            }),
        };
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { occurred_at: "desc" },
                ...toSkipTake(query),
            }),
            prisma.auditLog.count({ where }),
        ]);
        return { logs, meta: buildMeta(total, query) };
    },

    async getById(id: string) {
        const log = await prisma.auditLog.findUnique({ where: { id } });
        if (!log) throw AppError.notFound("AuditLog");
        return log;
    },
};
