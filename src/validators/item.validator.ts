import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";

const resourceCategory = z.enum([
    "FEED",
    "MEDICINE",
    "VACCINE",
    "SUPPLEMENT",
    "BIOSECURITY",
    "CHICKS",
    "HUSK",
    "EQUIPMENT",
    "UTILITIES",
    "SALARY",
    "TRANSPORTATION",
    "MAINTENANCE",
    "CLEANING_SUPPLIES",
    "OTHER",
]);

const unit = z.enum([
    "BIRD",
    "KG",
    "LITER",
    "BAG",
    "BOX",
    "UNIT",
    "SACHETS",
    "BOTTLE",
    "ML",
    "L",
    "G",
    "PCS",
    "VIAL",
    "DOSE",
    "OTHER",
]);

export const createItemSchema = z.object({
    name: z.string().min(1, "Name is required"),
    category: resourceCategory,
    unit,
    reorder_level: z.coerce.number().nonnegative().optional(),
    preferred_reorder_qty: z.coerce.number().nonnegative().optional(),
    lead_time_days: z.coerce.number().int().nonnegative().optional(),
    supplier_ids: z.array(z.string().uuid()).optional(),
});

export const updateItemSchema = createItemSchema.partial();

export const listItemsQuerySchema = paginationQuerySchema.extend({
    category: resourceCategory.optional(),
    is_active: z.enum(["true", "false"]).optional(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
