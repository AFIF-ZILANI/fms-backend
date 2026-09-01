import { z } from "zod";
import { unitSchema } from "@lib/enums";

const locationTypeSchema = z.enum(["WAREHOUSE", "HOUSE"]);

export const createStockTransferSchema = z.object({
    item_id: z.string().uuid(),
    from_location_type: locationTypeSchema,
    from_location_id: z.string().uuid(),
    to_location_type: locationTypeSchema,
    to_location_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    note: z.string().optional(),
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;
