import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createInventoryAdjustmentSchema = z
    .object({
        item_id: z.string().uuid(),
        warehouse_id: z.string().uuid().optional(),
        house_id: z.string().uuid().optional(),
        quantity_before: z.coerce.number().nonnegative(),
        quantity_after: z.coerce.number().nonnegative(),
        reason: z.string().min(1, "Reason is required"),
        note: z.string().optional(),
        recorded_by_id: z.string().uuid(),
        idempotency_key: z.string().min(1).optional(),
    })
    .refine((data) => data.warehouse_id !== undefined || data.house_id !== undefined, {
        message: "At least one of warehouse_id/house_id is required",
    });

export const listInventoryAdjustmentsQuerySchema = paginationQuerySchema.extend({
    item_id: z.string().uuid().optional(),
});

export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;
export type ListInventoryAdjustmentsQuery = z.infer<typeof listInventoryAdjustmentsQuerySchema>;
