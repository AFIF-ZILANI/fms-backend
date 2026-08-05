import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
    table_name: z.string().optional(),
    record_id: z.string().optional(),
    changed_by_id: z.string().uuid().optional(),
    action: z.enum(["CREATE", "UPDATE", "DELETE"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
