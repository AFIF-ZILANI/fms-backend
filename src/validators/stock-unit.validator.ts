import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { resourceCategorySchema } from "@lib/enums";

const stockUnitStatus = z.enum(["UNASSIGNED", "IN_STOCK", "IN_USE", "CONSUMED", "DISPOSED"]);

export const provisionStockUnitsSchema = z.object({
    count: z.coerce.number().int().positive().max(500, "Provision at most 500 codes at a time"),
});

export const bindStockUnitSchema = z.object({
    purchase_item_id: z.string().uuid(),
});

export const relocateStockUnitSchema = z.object({
    house_id: z.string().uuid(),
    idempotency_key: z.string().min(1).optional(),
});

export const listStockUnitsQuerySchema = paginationQuerySchema.extend({
    status: stockUnitStatus.optional(),
    house_id: z.string().uuid().optional(),
    category: resourceCategorySchema.optional(),
});

export type ProvisionStockUnitsInput = z.infer<typeof provisionStockUnitsSchema>;
export type BindStockUnitInput = z.infer<typeof bindStockUnitSchema>;
export type RelocateStockUnitInput = z.infer<typeof relocateStockUnitSchema>;
export type ListStockUnitsQuery = z.infer<typeof listStockUnitsQuerySchema>;
