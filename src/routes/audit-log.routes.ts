import { Hono } from "hono";
import { zValidatorRfc7807 } from "@lib/validator";
import { AuditLogController } from "@controllers/audit-log.controller";
import { listAuditLogsQuerySchema } from "@validators/audit-log.validator";

export const auditLogRoutes = new Hono();

auditLogRoutes.get(
    "/",
    zValidatorRfc7807("query", listAuditLogsQuerySchema),
    AuditLogController.getAll,
);
auditLogRoutes.get("/:id", AuditLogController.getById);
