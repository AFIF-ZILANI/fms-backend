import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createAllocationSchema = z
    .object({
        batch_id: z.string().uuid(),
        from_house_id: z.string().uuid().optional(),
        to_house_id: z.string().uuid().optional(),
        quantity: z.coerce.number().int().positive("Quantity must be positive"),
        // INITIAL is set internally by BatchService.create only -- not a
        // client-choosable reason here.
        reason: z.enum(["TRANSFER", "ADJUSTMENT"]),
        recorded_by_id: z.string().uuid(),
        idempotency_key: z.string().min(1).optional(),
    })
    .refine((data) => data.from_house_id !== undefined || data.to_house_id !== undefined, {
        message: "At least one of from_house_id/to_house_id is required",
    });

export const listAllocationsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
});

export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;
export type ListAllocationsQuery = z.infer<typeof listAllocationsQuerySchema>;
