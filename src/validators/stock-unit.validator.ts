import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { resourceCategorySchema } from "@lib/enums";

const stockUnitStatus = z.enum(["UNASSIGNED", "IN_STOCK", "IN_USE", "CONSUMED", "DISPOSED"]);

export const provisionStockUnitsSchema = z.object({
    count: z.coerce.number().int().positive().max(500, "Provision at most 500 codes at a time"),
});

export const bindStockUnitSchema = z.object({
    purchase_item_id: z.string().uuid(),
    // Optional, not required: the column is nullable (137 units predate it) and
    // the web dashboard's bind dialog posts only purchase_item_id. The field app
    // always sends it -- deliveries land at the farm gate, and FEATURES.md
    // §3.3/§4 name this as the accountability field for that.
    bound_by_id: z.string().uuid().optional(),
});

export const relocateStockUnitSchema = z.object({
    // null/omitted = return to the warehouse
    house_id: z.string().uuid().nullable().optional(),
    idempotency_key: z.string().min(1).optional(),
    // Links this event to the aggregate StockTransfer (and its StockLedger rows) it was part of.
    stock_transfer_id: z.string().uuid().optional(),
});

export const setStockUnitStatusSchema = z.object({
    status: stockUnitStatus,
});

export const listStockUnitsQuerySchema = paginationQuerySchema.extend({
    status: stockUnitStatus.optional(),
    house_id: z.string().uuid().optional(),
    category: resourceCategorySchema.optional(),
    // Free-text search over the unit id (which IS the QR payload) -- accepts a full
    // scanned id or a fragment. Substring match, so it's not a uuid.
    q: z.string().trim().min(1).optional(),
});

export type ProvisionStockUnitsInput = z.infer<typeof provisionStockUnitsSchema>;
export type BindStockUnitInput = z.infer<typeof bindStockUnitSchema>;
export type RelocateStockUnitInput = z.infer<typeof relocateStockUnitSchema>;
export type SetStockUnitStatusInput = z.infer<typeof setStockUnitStatusSchema>;
export type ListStockUnitsQuery = z.infer<typeof listStockUnitsQuerySchema>;
