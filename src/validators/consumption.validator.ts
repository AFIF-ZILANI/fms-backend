import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

export const createConsumptionSchema = z.object({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid(),
    item_id: z.string().uuid(),
    // Set for medicine/vaccine/equipment draws from a specific coded unit;
    // omitted for aggregate items (feed) -- see ConsumptionService for the
    // branch this drives.
    stock_unit_id: z.string().uuid().optional(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    date: z.coerce.date(),
    note: z.string().optional(),
    recorded_by_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export const listConsumptionsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
});

export type CreateConsumptionInput = z.infer<typeof createConsumptionSchema>;
export type ListConsumptionsQuery = z.infer<typeof listConsumptionsQuerySchema>;
