import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const alertType = z.enum(["EMPLOYEE", "BATCH", "FEED", "MEDICINE", "SYSTEM"]);
const alertLevel = z.enum(["INFO", "WARNING", "CRITICAL"]);
const alertActionType = z.enum(["PAY", "REASSIGN", "MARK_RESOLVED"]);

export const createAlertSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    type: alertType,
    level: alertLevel,
    related_id: z.string().uuid().optional(),
    action_type: alertActionType.optional(),
});

export const listAlertsQuerySchema = paginationQuerySchema.extend({
    type: alertType.optional(),
    level: alertLevel.optional(),
    status: z.enum(["ACTIVE", "RESOLVED"]).optional(),
});

export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
