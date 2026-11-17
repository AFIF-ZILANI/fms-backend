import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema } from "@lib/enums";

export const createConsumptionSchema = z.object({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid(),
    item_id: z.string().uuid(),
    // Set for medicine/vaccine/equipment draws from a specific coded unit;
    // omitted for aggregate items (feed) -- see ConsumptionService for the
    // branch this drives.
    stock_unit_id: z.string().uuid().optional(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    date: z.coerce.date(),
    note: z.string().optional(),
    idempotency_key: z.string().min(1).optional(),
});

export const listConsumptionsQuerySchema = paginationQuerySchema.extend({
    batch_id: z.string().uuid().optional(),
    house_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    occurred_from: z.coerce.date().optional(),
    occurred_to: z.coerce.date().optional(),
});

export type CreateConsumptionInput = z.infer<typeof createConsumptionSchema> & { recorded_by_id: string };
export type ListConsumptionsQuery = z.infer<typeof listConsumptionsQuerySchema>;

const fixReason = z.string().trim().min(1, "Say why this is being fixed").max(500);

/** "Fix usage": what really happened. Only the fields given change; house can't (remove and record again). */
export const fixConsumptionSchema = z
    .object({
        quantity: z.coerce.number().positive("Quantity must be positive").optional(),
        unit: unitSchema.optional(),
        // The right bottle for a scanned use. Web resolves a typed code through GET /stock-units?q=.
        stock_unit_id: z.string().uuid().optional(),
        date: z.coerce.date().optional(),
        reason: fixReason,
    })
    .refine(
        (v) => v.quantity !== undefined || v.unit !== undefined || v.stock_unit_id !== undefined || v.date !== undefined,
        { message: "Nothing to fix" },
    );

export const removeConsumptionSchema = z.object({ reason: fixReason });

export type FixConsumptionInput = z.infer<typeof fixConsumptionSchema> & { actor_id: string };
export type RemoveConsumptionInput = z.infer<typeof removeConsumptionSchema> & { actor_id: string };
