import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createInventoryAdjustmentSchema = z
    .object({
        item_id: z.string().uuid(),
        warehouse_id: z.string().uuid().optional(),
        house_id: z.string().uuid().optional(),
        // Ignored: the server reads the real balance from the ledger. Still accepted so a client
        // that sends it (web, mobile) keeps validating.
        quantity_before: z.coerce.number().nonnegative().optional(),
        quantity_after: z.coerce.number().nonnegative(),
        reason: z.string().min(1, "Reason is required"),
        note: z.string().optional(),
        idempotency_key: z.string().min(1).optional(),
    })
    .refine((data) => data.warehouse_id !== undefined || data.house_id !== undefined, {
        message: "At least one of warehouse_id/house_id is required",
    });

export const listInventoryAdjustmentsQuerySchema = paginationQuerySchema.extend({
    item_id: z.string().uuid().optional(),
});

export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema> & { recorded_by_id: string };
export type ListInventoryAdjustmentsQuery = z.infer<typeof listInventoryAdjustmentsQuerySchema>;
