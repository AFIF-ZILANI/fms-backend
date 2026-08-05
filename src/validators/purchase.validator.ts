import { z } from "zod";
import { paginationQuerySchema } from "@lib/pagination";
import { unitSchema } from "@lib/enums";

const purchaseItemInput = z.object({
    item_id: z.string().uuid(),
    batch_id: z.string().uuid().optional(),
    quantity: z.coerce.number().positive("Quantity must be positive"),
    unit: unitSchema,
    unit_price: z.coerce.number().positive("Unit price must be positive"),
    mfg_date: z.coerce.date().optional(),
    expiration_date: z.coerce.date().optional(),
});

export const createPurchaseSchema = z.object({
    supplier_id: z.string().uuid().optional(),
    invoice_no: z.string().optional(),
    purchase_date: z.coerce.date(),
    paid_amount: z.coerce.number().nonnegative().default(0),
    recorded_by_id: z.string().uuid(),
    items: z.array(purchaseItemInput).min(1, "At least one item is required"),
});

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
    supplier_id: z.string().uuid().optional(),
});

export const listPurchaseItemsQuerySchema = paginationQuerySchema.extend({
    item_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
export type ListPurchaseItemsQuery = z.infer<typeof listPurchaseItemsQuerySchema>;
