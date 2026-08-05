import type { Context } from "hono";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { AuditLogService } from "@services/audit-log.service";
import type { ListAuditLogsQuery } from "@validators/audit-log.validator";

export const AuditLogController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const query = getValid<ListAuditLogsQuery>(c, "query");
            const { logs, meta } = await AuditLogService.getAll(query);
            return sendList(c, logs, meta, "Audit logs fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const log = await AuditLogService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, log, "Audit log fetched successfully");
        });
    },
};
