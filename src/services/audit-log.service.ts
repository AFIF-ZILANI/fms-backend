import prisma from "@lib/db";
import { AppError } from "@lib/app-error";
import { toSkipTake, buildMeta } from "@lib/pagination";
import type { ListAuditLogsQuery } from "@validators/audit-log.validator";

/**
 * Read side. Rows are written by the services that perform a sensitive action
 * (lib/audit.ts): password resets and changes, hiring and terminating, admin
 * creation and deactivation, payout confirmation, payout account changes, and
 * salary overrides. Not every table is covered -- add an audit() call where a
 * change needs to answer "who did that".
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
