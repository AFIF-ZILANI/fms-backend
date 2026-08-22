import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema, resourceCategorySchema } from "@lib/enums";

export const createItemSchema = z.object({
    name: z.string().min(1, "Name is required"),
    category: resourceCategorySchema,
    unit: unitSchema,
    reorder_level: z.coerce.number().nonnegative().optional(),
    preferred_reorder_qty: z.coerce.number().nonnegative().optional(),
    lead_time_days: z.coerce.number().int().nonnegative().optional(),
    supplier_ids: z.array(z.string().uuid()).optional(),
    meta_data: z.record(z.string(), z.string()).optional(),
});

// unit is intentionally excluded -- ItemUnit conversion factors and every
// PurchaseItem/Consumption base_quantity snapshot are keyed off Item.unit at
// write time, so changing it after the fact would silently invalidate them.
export const updateItemSchema = createItemSchema.omit({ unit: true }).partial();

export const listItemsQuerySchema = paginationQuerySchema.extend({
    category: resourceCategorySchema.optional(),
    is_active: z.enum(["true", "false"]).optional(),
});

export const createItemUnitSchema = z
    .object({
        item_id: z.string().uuid(),
        unit: unitSchema,
        factor_to_base: z.coerce.number().positive("factor_to_base must be positive"),
        is_purchasable: z.coerce.boolean().default(true),
        is_usable: z.coerce.boolean().default(false),
    })
    .refine((data) => data.is_purchasable || data.is_usable, {
        message: "unit must be purchasable, usable, or both",
        path: ["is_purchasable"],
    });

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
export type CreateItemUnitInput = z.infer<typeof createItemUnitSchema>;
